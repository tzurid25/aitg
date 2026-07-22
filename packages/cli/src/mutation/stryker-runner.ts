import { spawn, type ChildProcess, type StdioOptions } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
 * Finds the absolute path to the Stryker plugin for a given test runner,
 * resolved from the user's project.
 *
 * This is deliberately separate from how Stryker CORE gets loaded (which is
 * now a clean `npx stryker run` subprocess — see runStrykerSubprocess below,
 * and KNOWN-ISSUES.md for why that changed). Spawning Stryker as its own
 * process fixes the "programmatic import breaks the child worker's
 * resolution context" bug, but it does NOT fix a second, separate problem:
 * under pnpm (and some other monorepo layouts), each package's node_modules
 * is strict/isolated, so Stryker's own default plugin discovery — a glob
 * over "@stryker-mutator/*" relative to wherever core itself resolves from —
 * doesn't see sibling plugin packages that aren't core's own declared
 * dependencies. This reproduces even with core running as a proper
 * subprocess from the project root, confirmed against a real pnpm
 * workspace: "command" and "vitest" test runners were both fine, but the
 * mocha/vitest plugin was reported as "not loaded" even though vitest and
 * @stryker-mutator/vitest-runner were both installed.
 *
 * The fix is the same shape as before: resolve the plugin's absolute entry
 * file ourselves, from the user's project, and hand Stryker a literal path
 * instead of asking it to discover the package by name. An absolute path
 * bypasses Node's module resolution (and therefore pnpm's isolation) rather
 * than working around it — it's not a package specifier Stryker's import()
 * needs to search for.
 */
function resolveRunnerPlugin(cwd: string, runner: string): string[] {
  // The command runner is built into core — there is no plugin to resolve.
  if (runner === "unknown" || runner === "command") return [];

  const pluginPackage = `@stryker-mutator/${runner}-runner`;

  try {
    const requireFromProject = createRequire(path.join(cwd, "package.json"));
    const pkgJsonPath = requireFromProject.resolve(`${pluginPackage}/package.json`);
    const pkgDir = path.dirname(pkgJsonPath);

    // Stryker's `plugins` entries are module specifiers or file paths that it
    // feeds to import(). A DIRECTORY is neither — passing one silently loads
    // nothing. Resolve the actual entry file from the exports map.
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      exports?: Record<string, { import?: string; default?: string } | string>;
      main?: string;
      module?: string;
    };

    const root = pkg.exports?.["."];
    const entry =
      (typeof root === "object" ? (root.import ?? root.default) : root) ??
      pkg.module ??
      pkg.main ??
      "./dist/src/index.js";

    return [path.resolve(pkgDir, entry)];
  } catch {
    // Not installed. Stryker's own message names the exact package, which is
    // clearer than anything we would invent.
    return [];
  }
}

/**
 * Runs Stryker the way it's actually designed to be run: as its own process,
 * invoked from the user's project root, with a config file on disk.
 *
 * Earlier versions of this file imported `@stryker-mutator/core` directly
 * (`loadStryker`) to work around the fact that we needed core loaded from
 * the *user's* project, not the CLI's own dependency tree. That approach is
 * not supported by Stryker: it spawns its own child process to host the
 * test runner, and that child resolves plugins through its own module
 * context. When core is loaded via an absolute file-path import from outside
 * the project, the child process doesn't inherit a resolution context that
 * can find sibling plugins — so it fails with "Cannot find TestRunner
 * plugin" even when the plugin is sitting right there in node_modules. This
 * was verified against Stryker directly, with no AITG code in the path at
 * all: the same failure reproduces regardless of whether the plugin is
 * passed as an absolute path or a package name.
 *
 * Spawning `npx stryker run` from `cwd: userProjectRoot` sidesteps that:
 * Stryker resolves core exactly as it does for every other user. Plugin
 * *discovery* is a separate concern, still handled explicitly via
 * resolveRunnerPlugin above. See KNOWN-ISSUES.md for the full writeup.
 */
/**
 * Turns Stryker's output into a specific cause and fix.
 *
 * Every pattern here is a failure that actually occurred during development,
 * each of which originally surfaced as the same unhelpful line: "stryker
 * exited with code 1". Diagnosing them meant re-running with AITG_DEBUG=1 and
 * reading a stack trace — fine for us, not fine for someone evaluating the
 * tool. If the output matches a known cause we name it directly; otherwise we
 * fall back to the raw tail, which still beats a bare exit code.
 */
function diagnoseStrykerFailure(
  output: string,
  runner: string,
): { message: string; hint: string } | null {
  const plugin = `@stryker-mutator/${runner}-runner`;

  if (/Cannot find TestRunner plugin|no TestRunner plugins were loaded/i.test(output)) {
    return {
      message: `Stryker could not load the "${runner}" test-runner plugin.`,
      hint:
        `Install it in this project:\n     npm install --save-dev ${plugin}\n` +
        `   If it is already installed, check that its peer dependency on ${runner} is satisfied\n` +
        `   (\`npm ls ${runner}\` will flag a version mismatch).`,
    };
  }

  if (/Tsconfig not found|TSCONFIG_ERROR/i.test(output)) {
    return {
      message: "The test runner could not find a tsconfig while running in Stryker's sandbox.",
      hint:
        "Stryker copies this package into a temporary sandbox, so a tsconfig that\n" +
        '   `extends` a file outside the package (e.g. "../../tsconfig.base.json")\n' +
        "   is not copied with it. Inline the settings into this package's tsconfig.json.",
    };
  }

  if (/There were failed tests in the initial test run/i.test(output)) {
    return {
      message: "Your test suite does not pass on its own, so mutation testing cannot start.",
      hint:
        "Stryker requires a green baseline: it compares mutated runs against a passing suite.\n" +
        "   Run your normal test command, fix the failures, then re-run `aitg scan`.",
    };
  }

  if (/No tests were executed/i.test(output)) {
    return {
      message: "Stryker ran, but your test runner executed no tests.",
      hint:
        "Usually the test files are not where the runner expects, or the mutated files\n" +
        "   have no corresponding tests. Confirm your normal test command runs tests\n" +
        "   from this directory.",
    };
  }

  if (/did not result in any files/i.test(output)) {
    return {
      message: "Stryker found no files to mutate for the changed lines.",
      hint:
        "The mutate patterns did not match anything on disk. If you are running from a\n" +
        "   subdirectory of the repository, try running `aitg scan` from the repo root.",
    };
  }

  if (/ENOSPC|no space left/i.test(output)) {
    return {
      message: "Ran out of disk space while creating Stryker's sandbox.",
      hint: "Free some space and re-run. `.test-guard/.stryker-tmp` can be deleted safely.",
    };
  }

  if (/Cannot find module|ERR_MODULE_NOT_FOUND/i.test(output)) {
    const missing = output.match(/Cannot find module '([^']+)'/)?.[1];
    return {
      message: missing
        ? `Stryker could not resolve the module "${missing}".`
        : "Stryker could not resolve a module it needs.",
      hint: "Check that dependencies are installed (`npm install`), then re-run.",
    };
  }

  return null;
}

function runStrykerSubprocess(
  cwd: string,
  configPath: string,
  runner: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const debug = process.env.AITG_DEBUG === "1";
    // Always capture stderr so failures can be diagnosed without asking the
    // user to re-run with a flag. Under AITG_DEBUG stdout is inherited too,
    // so Stryker's live progress stays visible.
    const stdio: StdioOptions = debug
      ? ["ignore", "inherit", "pipe"]
      : ["ignore", "pipe", "pipe"];

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
    child.stdout?.on("data", (chunk) => (output += chunk.toString()));
    child.stderr?.on("data", (chunk) => (output += chunk.toString()));

    child.on("error", (err) => {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        reject(
          new CliError(
            "Could not run `npx stryker` -- npx was not found on PATH.",
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

      const diagnosis = diagnoseStrykerFailure(output, runner);

      if (diagnosis) {
        reject(
          new CliError(
            diagnosis.message,
            debug
              ? diagnosis.hint
              : `${diagnosis.hint}\n\n   Re-run with AITG_DEBUG=1 for Stryker's full output.`,
          ),
        );
        return;
      }

      // Unrecognized failure: show the tail of Stryker's own output rather
      // than only an exit code, so the user has something to act on or paste
      // into an issue without a second run.
      const tail = output.trim().split("\n").slice(-25).join("\n");
      reject(
        new CliError(
          `Mutation testing failed (stryker exited with code ${code}).`,
          tail
            ? `Stryker reported:\n\n${tail}\n\n   Re-run with AITG_DEBUG=1 for the full output.`
            : "Re-run with AITG_DEBUG=1 for Stryker's own output.",
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

  // See resolveRunnerPlugin's docstring: needed for pnpm/monorepo layouts
  // where Stryker's own discovery can't see sibling plugin packages, even
  // running as a clean subprocess.
  const pluginPaths = resolveRunnerPlugin(options.cwd, detected.runner);

  const ours = buildStrykerConfig({
    targets: options.targets,
    testRunner: detected.runner,
    pluginPaths,
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

  // A crashed or interrupted previous run leaves its sandbox behind
  // (cleanTempDir only fires on a clean exit). Since Stryker's default
  // sandbox copy takes everything under the project directory, an orphaned
  // sandbox from a prior run gets copied INTO the next run's fresh sandbox
  // — and if that keeps happening across repeated failed runs, each one
  // nests one level deeper inside the last. Deep enough, that breaks
  // relative-path lookups (e.g. tsconfig resolution) inside the sandbox.
  // Clearing our own tempDir before every run guarantees a clean slate
  // regardless of how the previous run ended.
  await fs.rm(path.join(outputDir, ".stryker-tmp"), { recursive: true, force: true });

  // Stryker's CLI takes a config *file*, not an object, so the merged config
  // has to land on disk before we can spawn it.
  const configPath = path.join(outputDir, "stryker.conf.json");
  await fs.writeFile(configPath, JSON.stringify(merged, null, 2), "utf-8");

  const startedAt = Date.now();

  try {
    await runStrykerSubprocess(options.cwd, configPath, detected.runner);
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
