import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { ApiClient } from "../lib/api-client.js";
import { loadCredentials } from "../lib/credentials.js";
import { readProjectConfig } from "../lib/config.js";
import { resolveRepoIdentity } from "../lib/git.js";
import { analyzeDiff } from "../engine/index.js";
import {
  runMutationTests,
  generateMarkdownReport,
  generateFixPrompt,
  evaluateQualityGate,
} from "../mutation/index.js";
import { LOCAL_OUTPUT_DIR } from "../lib/constants.js";
import { logger, spinner } from "../lib/logger.js";
import { detectCiContext } from "../lib/ci.js";

export interface ScanOptions {
  base?: string;
  uncommitted?: boolean;
  dryRun?: boolean;
  noUpload?: boolean;
  concurrency?: string;
}

export async function scanCommand(options: ScanOptions): Promise<void> {
  logger.title("aitg scan");

  const cwd = process.cwd();
  const config = await readProjectConfig();

  // Scanning does NOT require an account.
  //
  // The whole value of this tool is visible locally: the mutation score, the
  // surviving mutants, and the fix prompt are all produced on this machine.
  // Gating that behind a signup would put the product's only proof of worth
  // on the far side of a registration form — and the free tier explicitly
  // promises local scanning without a cloud account.
  //
  // Credentials, when present, only add the upload.
  const creds = await loadCredentials();
  const api = creds ? ApiClient.forAuthenticatedUser(creds) : null;

  const ci = detectCiContext();

  const identitySpin = spinner("Resolving repository...").start();
  const identity = await resolveRepoIdentity();
  identitySpin.succeed(`Repository: ${chalk.bold(identity.fullName)}`);

  // ---- Phase 3: diff analysis ----
  const diffSpin = spinner("Analyzing changed code...").start();
  const diff = await analyzeDiff({
    baseRef: options.base,
    excludePatterns: config.excludePatterns,
    includeUncommitted: options.uncommitted ?? false,
    cwd,
  });
  diffSpin.succeed(
    `Diff against ${chalk.bold(diff.baseRef)} (${diff.baseSha.slice(0, 7)}..${diff.headSha.slice(0, 7)})`,
  );

  if (diff.files.length === 0) {
    logger.success("No mutable production code changed - nothing to scan.");
    if (diff.excludedPaths.length > 0) {
      logger.dim(`  ${diff.excludedPaths.length} file(s) excluded by filters.`);
    }
    return;
  }

  logger.title("Mutation surface");
  for (const file of diff.files) {
    const ranges = file.changedRanges
      .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
      .join(", ");
    console.log(
      `  ${chalk.white(file.path)} ${chalk.dim(`(${file.changedLineCount} lines: ${ranges})`)}`,
    );
  }
  console.log("");
  logger.keyValue("Files to mutate:   ", String(diff.files.length));
  logger.keyValue("Changed lines:     ", String(diff.totalChangedLines));
  logger.keyValue("Min mutation score:", `${config.minMutationScore}%`);

  if (options.dryRun) {
    console.log("");
    logger.success("Dry run complete - no mutation testing was performed.");
    return;
  }

  // ---- Phase 4: mutation testing ----
  const mutationSpin = spinner("Running mutation tests (this can take a while)...").start();

  const run = await runMutationTests({
    targets: diff.files.map((f) => ({ path: f.path, ranges: f.changedRanges })),
    cwd,
    concurrency: options.concurrency ? parseInt(options.concurrency, 10) : undefined,
  }).catch((err) => {
    mutationSpin.fail("Mutation testing failed.");
    throw err;
  });

  mutationSpin.succeed(
    `Mutation testing complete (${run.testRunner}, ${run.score.total} mutants).`,
  );

  // ---- Reports ----
  const outputDir = path.join(cwd, LOCAL_OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });

  const markdown = generateMarkdownReport({
    run,
    diff,
    threshold: config.minMutationScore,
    repositoryName: identity.fullName,
  });
  const fixPrompt = generateFixPrompt({ run, threshold: config.minMutationScore });

  await fs.writeFile(path.join(outputDir, "report.md"), markdown, "utf-8");
  await fs.writeFile(path.join(outputDir, "fix-prompt.md"), fixPrompt, "utf-8");

  // ---- Results ----
  logger.title("Results");
  const scoreColor =
    run.score.score >= config.minMutationScore ? chalk.green : chalk.red;
  console.log(`  Mutation score: ${scoreColor.bold(`${run.score.score}%`)}`);
  logger.keyValue("Killed:      ", String(run.score.killed));
  logger.keyValue("Survived:    ", String(run.score.survived));
  logger.keyValue("Timed out:   ", String(run.score.timedOut));
  logger.keyValue("No coverage: ", String(run.score.noCoverage));

  if (run.survivors.length > 0) {
    logger.title("Surviving mutants");
    for (const mutant of run.survivors.slice(0, 10)) {
      console.log(
        `  ${chalk.yellow("!")} ${mutant.filePath}:${mutant.lineNumber} ${chalk.dim(`(${mutant.mutatorName})`)}`,
      );
    }
    if (run.survivors.length > 10) {
      logger.dim(`  ...and ${run.survivors.length - 10} more (see report).`);
    }
  }

  // ---- Upload ----
  if (!api) {
    logger.dim("");
    logger.dim("  Not signed in - results stayed on this machine.");
    logger.dim("  Run `aitg login` to keep history and track score over time.");
  } else if (!options.noUpload) {
    const uploadSpin = spinner("Uploading results...").start();
    try {
      const link = await api.linkRepository({
        projectSlug: config.projectSlug,
        fullName: identity.fullName,
        defaultBranch: identity.defaultBranch,
        provider: identity.provider,
      });
      const upload = await api.uploadScanReport({
        repositoryId: link.repositoryId,
        commitSha: diff.headSha,
        branch: diff.baseRef,
        trigger: ci.pullRequestNumber ? "GITHUB_PR" : "CLI",
        pullRequestNumber: ci.pullRequestNumber,
        score: run.score,
        mutants: run.mutants,
        durationMs: run.durationMs,
      });
      uploadSpin.succeed(`Uploaded. View: ${chalk.underline(upload.dashboardUrl)}`);
      logger.dim(`  Quota: ${upload.quota.used}/${upload.quota.limit} mutants this period.`);
    } catch (err) {
      // A failed upload must never fail the developer's build - the local
      // report and quality gate are fully valid without the cloud.
      uploadSpin.warn(
        `Upload failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      logger.dim("  Local report is still available; the gate result below stands.");
    }
  }

  // ---- Quality gate ----
  const gate = evaluateQualityGate(run.score, {
    minMutationScore: config.minMutationScore,
    maxSurvivedMutants: config.maxSurvivedMutants,
    failBuildOnBreach: config.failBuildOnBreach,
  });

  console.log("");
  if (gate.status === "PASSED") {
    logger.success(`Quality gate passed. ${gate.reason}`);
  } else if (gate.status === "WARNING") {
    logger.warn(`Quality gate breached (not failing build). ${gate.reason}`);
  } else {
    logger.error(`Quality gate failed. ${gate.reason}`);
  }

  logger.dim(`\n  Report:     ${path.join(LOCAL_OUTPUT_DIR, "report.md")}`);
  logger.dim(`  Fix prompt: ${path.join(LOCAL_OUTPUT_DIR, "fix-prompt.md")}`);

  process.exitCode = gate.exitCode;
}
