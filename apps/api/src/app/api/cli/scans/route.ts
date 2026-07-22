import { prisma } from "@aitg/database";
import {
  uploadScanRequestSchema,
  resolveSeverity,
  sanitizeReplay,
  type UploadScanResponse,
} from "@aitg/shared";
import { ApiAuthError, authenticateRequest, scopedWhere } from "../../../../lib/auth";
import { consumeQuota } from "../../../../lib/quota";
import { enforceRateLimit, orgKey, RATE_LIMITS } from "../../../../lib/rate-limit";
import { handleRoute, ok, parseBody } from "../../../../lib/http";
import { reportProcessingQueue, notificationQueue, billingQueue } from "../../../../lib/queues";

export const dynamic = "force-dynamic";

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "https://app.aitg.dev";

/** Chunk size for the mutant bulk insert — keeps each statement well under
 *  Postgres' parameter limit while avoiding thousands of round trips. */
const MUTANT_CHUNK_SIZE = 1000;

/**
 * Receives a completed mutation report from the CLI.
 *
 * Note what this endpoint does NOT do: run mutations. Compute happens on the
 * developer's machine, so the meterable event is the upload itself — which is
 * why quota is consumed here, and why it's consumed BEFORE any rows are
 * written. Persisting first and metering after would let a client exceed its
 * limit and still have the data stored.
 */
export const POST = handleRoute(async (request) => {
  const auth = await authenticateRequest(request);

  // Before parsing the body. A caller in a retry loop shouldn't get us to
  // deserialize a multi-megabyte report just to reject it afterwards.
  await enforceRateLimit(
    orgKey(auth, "scan-upload"),
    RATE_LIMITS.scanUpload,
    "scan uploads",
  );

  const body = await parseBody(request, uploadScanRequestSchema);

  // Scoped: a repositoryId belonging to another tenant must not resolve.
  const repository = await prisma.repository.findFirst({
    where: scopedWhere(auth, { id: body.repositoryId }),
    select: {
      id: true,
      projectId: true,
      fullName: true,
      githubInstallationId: true,
      project: {
        select: {
          qualityGates: {
            where: { isActive: true },
            take: 1,
            select: {
              id: true,
              minMutationScore: true,
              maxSurvivedMutants: true,
              failBuildOnBreach: true,
            },
          },
        },
      },
    },
  });

  if (!repository) {
    throw new ApiAuthError("Repository not found.", 404, "REPOSITORY_NOT_FOUND");
  }

  // Throws 402 before anything is persisted.
  const quota = await consumeQuota(auth, body.score.total);

  // P0 first: a scan that broke is a different event from a scan that ran and
  // found weak tests, and conflating them lets a dead pipeline look like bad
  // code. Resolved before the row is written so status and severity can never
  // disagree.
  const verdict = resolveSeverity({
    scanFailed: body.scanFailed ?? false,
    gateStatus: null, // gate is evaluated below; re-resolved afterwards
    mutantsTotal: body.score.total,
  });

  const testRun = await prisma.testRun.create({
    data: {
      organizationId: auth.organizationId,
      repositoryId: repository.id,
      status: body.scanFailed ? "FAILED" : "COMPLETED",
      severity: verdict.severity,
      trigger: body.trigger,
      commitSha: body.commitSha,
      branch: body.branch,
      pullRequestNumber: body.pullRequestNumber,
      mutationScore: body.score.score,
      mutantsTotal: body.score.total,
      mutantsKilled: body.score.killed,
      mutantsSurvived: body.score.survived,
      mutantsTimedOut: body.score.timedOut,
      mutantsNoCoverage: body.score.noCoverage,
      startedAt: body.durationMs ? new Date(Date.now() - body.durationMs) : new Date(),
      completedAt: new Date(),
    },
    select: { id: true },
  });

  // createMany in chunks rather than one giant statement or N inserts.
  for (let i = 0; i < body.mutants.length; i += MUTANT_CHUNK_SIZE) {
    const chunk = body.mutants.slice(i, i + MUTANT_CHUNK_SIZE);
    await prisma.mutant.createMany({
      data: chunk.map((m) => ({
        organizationId: auth.organizationId,
        testRunId: testRun.id,
        filePath: m.filePath,
        lineNumber: m.lineNumber,
        columnNumber: m.columnNumber,
        mutatorName: m.mutatorName,
        status: m.status,
        originalCode: m.originalCode,
        mutatedCode: m.mutatedCode,
        killedByTest: m.killedByTest,
      })),
    });
  }

  // Evaluate the server-side quality gate, if the project has one. The CLI
  // evaluates locally too — this is the authoritative record for the
  // dashboard and for GitHub checks in Phase 7.
  let gateResult: UploadScanResponse["qualityGate"];
  const gate = repository.project.qualityGates[0];

  if (gate) {
    const breaches: string[] = [];
    if (body.score.score < gate.minMutationScore) {
      breaches.push(
        `mutation score ${body.score.score}% is below the ${gate.minMutationScore}% threshold`,
      );
    }
    if (gate.maxSurvivedMutants !== null && body.score.survived > gate.maxSurvivedMutants) {
      breaches.push(
        `${body.score.survived} surviving mutants exceeds the limit of ${gate.maxSurvivedMutants}`,
      );
    }

    const status =
      breaches.length === 0 ? "PASSED" : gate.failBuildOnBreach ? "FAILED" : "WARNING";
    const reason = breaches.length === 0 ? "All thresholds met." : breaches.join("; ");

    await prisma.qualityGateResult.create({
      data: {
        organizationId: auth.organizationId,
        qualityGateId: gate.id,
        testRunId: testRun.id,
        status,
        reason,
      },
    });

    gateResult = { status, reason };

    // Now that the gate has spoken, settle the final severity. P0 still wins:
    // resolveSeverity checks scanFailed before it looks at any gate outcome.
    const finalVerdict = resolveSeverity({
      scanFailed: body.scanFailed ?? false,
      gateStatus: status,
      mutantsTotal: body.score.total,
    });

    await prisma.testRun.update({
      where: { id: testRun.id },
      data: { severity: finalVerdict.severity },
    });

    if (status === "FAILED") {
      await notificationQueue.add("quality.failed", {
        organizationId: auth.organizationId,
        testRunId: testRun.id,
        event: "quality.failed",
      });
    }
  }

  // ---- Replay ----
  // Metadata only. See the ScanReplay model for why no source is stored.
  if (body.replay) {
    try {
      const safe = sanitizeReplay(body.replay);
      await prisma.scanReplay.create({
        data: {
          organizationId: auth.organizationId,
          testRunId: testRun.id,
          cliVersion: safe.cliVersion,
          strykerVersion: safe.strykerVersion,
          testRunner: safe.testRunner,
          nodeVersion: safe.nodeVersion,
          platform: safe.platform,
          baseRef: safe.baseRef,
          headSha: safe.headSha,
          changedFiles: safe.changedFiles as object | undefined,
          mutatedRanges: safe.mutatedRanges as object | undefined,
          diffDurationMs: safe.diffDurationMs,
          mutationDurationMs: safe.mutationDurationMs,
          uploadDurationMs: safe.uploadDurationMs,
          failureStage: safe.failureStage,
          failureMessage: safe.failureMessage,
        },
      });
    } catch (err) {
      // Replay is a debugging aid. Losing it must never fail an upload.
      console.error("[scans] replay persistence failed:", err);
    }
  }

  // ---- GitHub feedback ----
  // Posted only when the repo arrived through the GitHub App and the scan
  // names a pull request. A CLI scan on a local branch has nowhere to post,
  // and that is a normal case rather than an error.
  if (repository.githubInstallationId && body.pullRequestNumber) {
    try {
      const survivors = body.mutants.filter((m) => m.status === "SURVIVED");

      await concludeCheck({
        installationId: repository.githubInstallationId,
        fullName: repository.fullName,
        headSha: body.commitSha,
        score: body.score.score,
        threshold: gate?.minMutationScore ?? 0,
        survived: body.score.survived,
        total: body.score.total,
        noCoverage: body.score.noCoverage,
        passed: gateResult ? gateResult.status === "PASSED" : true,
        blocking: gate?.failBuildOnBreach ?? false,
        dashboardUrl: `${DASHBOARD_URL}/app/runs/${testRun.id}`,
        survivors,
      });

      await upsertPrComment({
        installationId: repository.githubInstallationId,
        fullName: repository.fullName,
        pullRequestNumber: body.pullRequestNumber,
        score: body.score.score,
        threshold: gate?.minMutationScore ?? 0,
        survived: body.score.survived,
        passed: gateResult ? gateResult.status === "PASSED" : true,
        dashboardUrl: `${DASHBOARD_URL}/app/runs/${testRun.id}`,
        survivors,
      });
    } catch (err) {
      // A GitHub outage must not fail the upload. The run is already
      // persisted and the CLI has already made its own gate decision
      // locally; losing the PR comment is a degraded experience, not a
      // broken build.
      console.error("[scans] GitHub feedback failed:", err);
    }
  }

  // Async follow-up work: aggregate rollups, notifications, usage records.
  // Queued rather than awaited so upload latency stays low — the CLI is
  // blocking a developer's terminal (or a CI step) while this responds.
  await Promise.all([
    reportProcessingQueue.add("scan.completed", {
      testRunId: testRun.id,
      organizationId: auth.organizationId,
    }),
    billingQueue.add("usage.recorded", {
      organizationId: auth.organizationId,
      event: "usage.recorded",
      mutantCount: body.score.total,
    }),
  ]);

  return ok<UploadScanResponse>({
    testRunId: testRun.id,
    dashboardUrl: `${DASHBOARD_URL}/runs/${testRun.id}`,
    qualityGate: gateResult,
    quota: { used: quota.used, limit: quota.limit },
  });
});
