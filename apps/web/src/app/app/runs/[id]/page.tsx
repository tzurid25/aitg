import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@aitg/database";
import { Card, SectionLabel, ScoreDial, GateBadge, StatusBadge } from "@aitg/ui";
import { SEVERITY_LABEL, SEVERITY_COLOR, type RunSeverity } from "@aitg/shared";
import { requireSession, scoped } from "../../../../lib/session";
import { PageHeader } from "../../../../components/AppShell";
import { RunExplorer } from "../../../../components/RunExplorer";
import { relativeTime, shortSha } from "../../../../lib/format";

export const dynamic = "force-dynamic";

// Next 15 made route params a Promise. Awaiting it is also valid in 14,
// so this change is safe on both versions.
export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();

  // Scoped: a run id from another tenant must 404, not leak.
  const run = await prisma.testRun.findFirst({
    where: scoped(session, { id }),
    select: {
      id: true,
      createdAt: true,
      branch: true,
      commitSha: true,
      trigger: true,
      severity: true,
      mutationScore: true,
      mutantsTotal: true,
      mutantsKilled: true,
      mutantsSurvived: true,
      mutantsTimedOut: true,
      mutantsNoCoverage: true,
      startedAt: true,
      completedAt: true,
      repository: {
        select: {
          fullName: true,
          project: {
            select: {
              name: true,
              qualityGates: {
                where: { isActive: true },
                take: 1,
                select: { minMutationScore: true },
              },
            },
          },
        },
      },
      qualityGateResult: { select: { status: true, reason: true } },
      replay: {
        select: {
          cliVersion: true,
          strykerVersion: true,
          testRunner: true,
          nodeVersion: true,
          platform: true,
          baseRef: true,
          diffDurationMs: true,
          mutationDurationMs: true,
          failureStage: true,
          failureMessage: true,
        },
      },
      mutants: {
        select: {
          id: true,
          filePath: true,
          lineNumber: true,
          mutatorName: true,
          status: true,
          originalCode: true,
          mutatedCode: true,
        },
        orderBy: [{ filePath: "asc" }, { lineNumber: "asc" }],
      },
    },
  });

  if (!run) notFound();

  const threshold = run.repository.project.qualityGates[0]?.minMutationScore ?? 70;

  return (
    <>
      <div style={{ marginBottom: 6 }}>
        <Link href="/app/runs" className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>
          ג† Runs
        </Link>
      </div>

      <PageHeader
        title={run.repository.fullName}
        description={`${run.branch ?? "unknown branch"} ֲ· ${shortSha(run.commitSha)} ֲ· ${relativeTime(run.createdAt)}`}
        action={run.qualityGateResult ? <GateBadge status={run.qualityGateResult.status} /> : undefined}
      />

      {/* P0 outranks everything. A broken scan produces a meaningless score,
          so the score is suppressed entirely rather than shown as 0% ג€” which
          would read as "your tests are terrible" instead of "this didn't
          run". */}
      {run.severity === "P0_SCAN_BROKEN" && (
        <div
          style={{
            padding: "14px 16px",
            marginBottom: 18,
            background: "var(--runtime-error-dim)",
            border: "1px solid var(--fail)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--fail)" }}>
            This scan did not complete
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
            No usable mutation score was produced. Fix the scan before reading
            anything into the numbers below.
            {run.replay?.failureStage && (
              <>
                {" "}
                Failed during{" "}
                <span className="mono" style={{ color: "var(--text)" }}>
                  {run.replay.failureStage}
                </span>
                .
              </>
            )}
          </div>
          {run.replay?.failureMessage && (
            <pre
              className="mono"
              style={{
                marginTop: 10,
                marginBottom: 0,
                padding: 10,
                fontSize: 11.5,
                background: "var(--bg)",
                borderRadius: "var(--radius-sm)",
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflow: "auto",
              }}
            >
              {run.replay.failureMessage}
            </pre>
          )}
        </div>
      )}

      {run.qualityGateResult && run.qualityGateResult.status !== "PASSED" && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 18,
            background: "var(--survived-dim)",
            border: "1px solid var(--survived)",
            borderRadius: "var(--radius-md)",
            fontSize: 13.5,
          }}
        >
          {run.qualityGateResult.reason}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, marginBottom: 18 }}>
        <Card>
          <SectionLabel>Mutation score</SectionLabel>
          <ScoreDial score={run.mutationScore ?? 0} threshold={threshold} />
        </Card>

        <Card>
          <SectionLabel>Breakdown</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 14 }}>
            <Stat label="Killed" value={run.mutantsKilled ?? 0} color="var(--killed)" />
            <Stat label="Survived" value={run.mutantsSurvived ?? 0} color="var(--survived)" />
            <Stat label="Timed out" value={run.mutantsTimedOut ?? 0} color="var(--timeout)" />
            <Stat label="No coverage" value={run.mutantsNoCoverage ?? 0} color="var(--no-coverage)" />
            <Stat label="Total" value={run.mutantsTotal ?? 0} color="var(--text)" />
          </div>

          {(run.mutantsNoCoverage ?? 0) > 0 && (
            <div style={{ marginTop: 16, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {run.mutantsNoCoverage} mutant{(run.mutantsNoCoverage ?? 0) === 1 ? "" : "s"} had no
              test coverage at all. These don&apos;t affect the score, but the code runs entirely
              unverified.
            </div>
          )}
        </Card>
      </div>

      {run.replay && (
        <div style={{ marginBottom: 18 }}>
          <Card>
            <SectionLabel>Session replay</SectionLabel>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.6 }}>
              Environment and timings captured with this scan. No source code is
              stored ג€” paths and line ranges only.
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 14,
              }}
            >
              <ReplayField label="CLI" value={run.replay.cliVersion} />
              <ReplayField label="Stryker" value={run.replay.strykerVersion} />
              <ReplayField label="Test runner" value={run.replay.testRunner} />
              <ReplayField label="Node" value={run.replay.nodeVersion} />
              <ReplayField label="Platform" value={run.replay.platform} />
              <ReplayField label="Base ref" value={run.replay.baseRef} />
              <ReplayField
                label="Diff"
                value={run.replay.diffDurationMs ? `${run.replay.diffDurationMs}ms` : null}
              />
              <ReplayField
                label="Mutation"
                value={
                  run.replay.mutationDurationMs
                    ? `${(run.replay.mutationDurationMs / 1000).toFixed(1)}s`
                    : null
                }
              />
            </div>
          </Card>
        </div>
      )}

      <RunExplorer
        mutants={run.mutants.map((m) => ({
          id: m.id,
          filePath: m.filePath,
          lineNumber: m.lineNumber,
          mutatorName: m.mutatorName,
          status: m.status,
          originalCode: m.originalCode,
          mutatedCode: m.mutatedCode,
        }))}
        score={run.mutationScore ?? 0}
        threshold={threshold}
      />
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mono" style={{ fontSize: 21, fontWeight: 600, color, marginTop: 3 }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ReplayField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mono" style={{ fontSize: 12.5, marginTop: 3, color: value ? "var(--text)" : "var(--text-faint)" }}>
        {value ?? "ג€”"}
      </div>
    </div>
  );
}
