import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { CliError } from "../lib/logger.js";
import { buildStrykerConfig, readExistingStrykerConfig, OUTPUT_DIR } from "./stryker-config.js";
import { detectTestRunner } from "./detect-runner.js";
import type {
  MutantResult,
  MutantStatus,
  MutationRunOptions,
  MutationRunResult,
  MutationScore,
} from "./types.js";

/**
 * Stryker's own status strings, which differ in casing/naming from our
 * Prisma MutantStatus enum.
 */
const STATUS_MAP: Record<string, MutantStatus> = {
  Killed: "KILLED",
  Survived: "SURVIVED",
  Timeout: "TIMEOUT",
  NoCoverage: "NO_COVERAGE",
  CompileError: "RUNTIME_ERROR",
  RuntimeError: "RUNTIME_ERROR",
  Ignored: "IGNORED",
};

interface StrykerJsonReport {
  files: Record<
    string,
    {
      source?: string;
      mutants: Array<{
        id: string;
        mutatorName: string;
        status: string;
        replacement?: string;
        location: {
          start: { line: number; column: number };
          end: { line: number; column: number };
        };
        killedBy?: string[];
        testsCompleted?: number;
      }>;
    }
  >;
}

/**
 * Runs Stryker the way it's actually designed to be run: as its own process,
 * invoked from the user's project root, with a config file on disk.
 *
 * Earlier versions of this file imported `@stryker-mutator/core` directly
 * (`loadStryker`) and hand-resolved the runner plugin's entry file
 * (`resolveRunnerPlugin`) to work around it. That approach is not supported
 * by Stryker: it spawns its own child process to host the test runner, and
 * that child resolves plugins through its own module context. When core is
 * loaded via an absolute file-path import from outside the project, the
 * child process doesn't inherit a resolution context that can find sibling
 * plugins — so it fails with "Cannot find TestRunner plugin" even when the
 * plugin is sitting right there in node_modules. This was verified against
 * Stryker directly, with no AITG code in the path at all: the same failure
 * reproduces regardless of whether the plugin is passed as an absolute path
 * or a package name.
 *
 * Spawning `npx stryker run` from `cwd: userProjectRoot` sidesteps all of
 * that: Stryker resolves its own plugins exactly as it does for every other
 * user, so plugin discovery is Stryker's problem again, not ours. See
 * KNOWN-ISSUES.md for the full writeup.
 */
function runStrykerSubprocess(cwd: string, configPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const debug = process.env.AITG_DEBUG === "1";
    // Inherit stdio under AITG_DEBUG so Stryker's own progress and errors are
    // visible live. Otherwise capture it — our own logLevel: "warn" config
    // already keeps Stryker quiet, and a failure surfaces via the rejected
    // promise below with a pointer to re-run with AITG_DEBUG=1.
    const stdio: StdioOptions = debug ? "inherit" : ["ignore", "pipe", "pipe"];

    // npx resolves to npx.cmd on Windows, and Windows can't exec .cmd/.bat
    // files directly through spawn — it needs a shell to interpret them.
    // Without a shell here, spawn throws "spawn EINVAL" before the process
    // even starts. Node also warns (DEP0190) about combining shell: true
    // with a separate args array, since it just concatenates them — so on
    // Windows we build and quote a single command string ourselves instead
    // of handing spawn an args array to concatenate ambiguously.
    let child: ChildProcess;
    if (isWindows) {
      child = spawn(`npx.cmd stryker run "${configPath.replace(/"/g, '\\"')}"`, {
        cwd,
        shell: true,
        stdio,
      });
    } else {
      child = spawn("npx", ["stryker", "run", configPath], { cwd, stdio });
    }

    let output = "";
    if (!debug) {
      child.stdout?.on("data", (chunk) => (output += chunk.toString()));
      child.stderr?.on("data", (chunk) => (output += chunk.toString()));
    }

    child.on("error", (err) => {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        reject(
          new CliError(
            "Could not run `npx stryker` — npx was not found on PATH.",
            "npx ships with npm; make sure Node.js is installed and on PATH.",
          ),
        );
        return;
      }
      reject(new CliError(`Failed to start Stryker: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new CliError(
          `Mutation testing failed (stryker exited with code ${code}).`,
          debug
            ? "Verify your test suite passes on its own first: run your normal test command."
            : `Re-run with AITG_DEBUG=1 for Stryker's own output.${
                output.trim() ? `\n\n${output.trim().split("\n").slice(-20).join("\n")}` : ""
              }`,
        ),
      );
    });
  });
}

function computeScore(mutants: MutantResult[]): MutationScore {
  const counts = {
    killed: 0,
    survived: 0,
    timedOut: 0,
    noCoverage: 0,
    runtimeErrors: 0,
    ignored: 0,
  };

  for (const mutant of mutants) {
    switch (mutant.status) {
      case "KILLED":
        counts.killed++;
        break;
      case "SURVIVED":
        counts.survived++;
        break;
      case "TIMEOUT":
        counts.timedOut++;
        break;
      case "NO_COVERAGE":
        counts.noCoverage++;
        break;
      case "RUNTIME_ERROR":
        counts.runtimeErrors++;
        break;
      case "IGNORED":
        counts.ignored++;
        break;
    }
  }

  // Mutation score based on COVERED code: killed / (killed + survived +
  // timeout). A timeout counts as detected — the test suite noticed
  // something was wrong, even if only by hanging.
  const denominator = counts.killed + counts.survived + counts.timedOut;
  const score = denominator === 0 ? 100 : (counts.killed + counts.timedOut) / denominator * 100;

  return {
    score: Math.round(score * 100) / 100,
    total: mutants.length,
    ...counts,
  };
}

async function readStrykerReport(cwd: string): Promise<MutantResult[]> {
  const reportPath = path.join(cwd, OUTPUT_DIR, "stryker-report.json");

  let report: StrykerJsonReport;
  try {
    report = JSON.parse(await fs.readFile(reportPath, "utf-8")) as StrykerJsonReport;
  } catch {
    throw new CliError(
      "Stryker finished but produced no readable report.",
      `Expected a JSON report at ${reportPath}. Re-run with AITG_DEBUG=1 for Stryker's own output.`,
    );
  }

  const mutants: MutantResult[] = [];

  for (const [filePath, file] of Object.entries(report.files)) {
    const sourceLines = file.source?.split("\n");

    for (const mutant of file.mutants) {
      const line = mutant.location.start.line;
      mutants.push({
        id: mutant.id,
        filePath: filePath.split(path.sep).join("/"),
        lineNumber: line,
        columnNumber: mutant.location.start.column,
        mutatorName: mutant.mutatorName,
        status: STATUS_MAP[mutant.status] ?? "RUNTIME_ERROR",
        originalCode: sourceLines?.[line - 1]?.trim(),
        mutatedCode: mutant.replacement,
        killedByTest: mutant.killedBy?.[0],
      });
    }
  }

  return mutants;
}

export async function runMutationTests(
  options: MutationRunOptions,
): Promise<MutationRunResult> {
  if (options.targets.length === 0) {
    throw new CliError("No mutation targets provided.");
  }

  const detected = await detectTestRunner(options.cwd);

  if (detected.runner === "unknown") {
    throw new CliError(
      "Could not find a package.json in this project.",
      "Run `aitg scan` from your project root.",
    );
  }

  const existing = await readExistingStrykerConfig(options.cwd);
  const ours = buildStrykerConfig({
    targets: options.targets,
    testRunner: detected.runner,
    cwd: options.cwd,
    concurrency: options.concurrency,
    timeoutMs: options.timeoutMs,
    incremental: options.incremental,
    highSignalOnly: true,
  });

  // Project config first, ours second — our cost-control settings and
  // line-scoped `mutate` must win, but everything else the team configured
  // (plugins, custom commands, ignore patterns) is preserved.
  const merged = { ...(existing ?? {}), ...ours };

  const outputDir = path.join(options.cwd, OUTPUT_DIR);
  await fs.mkdir(outputDir, { recursive: true });

  // Stryker's CLI takes a config *file*, not an object, so the merged config
  // has to land on disk before we can spawn it.
  const configPath = path.join(outputDir, "stryker.conf.json");
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2), "utf-8");

  const startedAt = Date.now();

  try {
    await runStrykerSubprocess(options.cwd, configPath);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw new CliError(
      `Mutation testing failed: ${err instanceof Error ? err.message : String(err)}`,
      "Verify your test suite passes on its own first: run your normal test command.",
    );
  }

  const durationMs = Date.now() - startedAt;
  const mutants = await readStrykerReport(options.cwd);

  return {
    score: computeScore(mutants),
    mutants,
    survivors: mutants.filter((m) => m.status === "SURVIVED"),
    durationMs,
    testRunner: detected.runner,
  };
}
