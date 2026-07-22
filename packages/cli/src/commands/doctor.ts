import chalk from "chalk";
import simpleGit from "simple-git";
import { ApiClient } from "../lib/api-client.js";
import { loadCredentials } from "../lib/credentials.js";
import { projectConfigExists, readProjectConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { API_BASE_URL } from "../lib/constants.js";
import { detectTestRunner } from "../mutation/detect-runner.js";

type CheckResult = { label: string; ok: boolean; detail: string };

async function checkNodeVersion(): Promise<CheckResult> {
  const major = Number(process.versions.node.split(".")[0]);
  const ok = major >= 18;
  return {
    label: "Node.js version",
    ok,
    detail: ok
      ? `v${process.versions.node}`
      : `v${process.versions.node} -- aitg requires Node 18+`,
  };
}

async function checkGitInstalled(): Promise<CheckResult> {
  try {
    const git = simpleGit();
    const version = await git.version();
    return { label: "git installed", ok: true, detail: String(version) };
  } catch {
    return { label: "git installed", ok: false, detail: "git not found on PATH" };
  }
}

async function checkIsGitRepo(): Promise<CheckResult> {
  try {
    const isRepo = await simpleGit().checkIsRepo();
    return {
      label: "current directory is a git repo",
      ok: isRepo,
      detail: isRepo ? "yes" : "no -- run inside your project repo",
    };
  } catch {
    return { label: "current directory is a git repo", ok: false, detail: "could not determine" };
  }
}

async function checkLoggedIn(): Promise<CheckResult> {
  const creds = await loadCredentials();
  return {
    label: "authenticated",
    ok: creds !== null,
    detail: creds ? `${creds.userEmail} (${creds.organizationSlug})` : "not logged in -- run `aitg login`",
  };
}

async function checkApiReachable(): Promise<CheckResult> {
  const creds = await loadCredentials();

  try {
    if (creds) {
      const api = new ApiClient(creds.apiKey);
      await api.whoami();
      return { label: "API reachable", ok: true, detail: API_BASE_URL };
    }

    // Unauthenticated: hit the health endpoint directly.
    //
    // This previously constructed a client and returned ok WITHOUT making any
    // request — reporting "reachable" for a host it had never contacted. A
    // false green here is worse than a red, because doctor is the first thing
    // someone runs when a scan misbehaves, and a wrong answer sends them
    // looking in the wrong place.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(`${API_BASE_URL}/api/health`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          label: "API reachable",
          ok: false,
          detail: `${API_BASE_URL} responded ${response.status}`,
        };
      }

      return {
        label: "API reachable",
        ok: true,
        detail: `${API_BASE_URL} (not signed in -- local scans still work)`,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? "timed out after 5s"
        : err instanceof Error
          ? err.message
          : "unknown error";

    return {
      label: "API reachable",
      ok: false,
      detail: `${API_BASE_URL} -- ${reason}. Local scans still work without it.`,
    };
  }
}

async function checkTestRunner(): Promise<CheckResult> {
  const detected = await detectTestRunner(process.cwd());

  if (detected.runner === "unknown") {
    return {
      label: "test runner",
      ok: false,
      detail: "no package.json found -- run `aitg doctor` from your project root",
    };
  }

  if (detected.runner === "command") {
    return {
      label: "test runner",
      ok: true,
      detail: "no supported plugin detected -- will fall back to Stryker's command runner (slower, works with any framework)",
    };
  }

  return {
    label: "test runner",
    ok: true,
    detail: `${detected.runner} -- will use ${detected.strykerPlugin}`,
  };
}

async function checkProjectConfig(): Promise<CheckResult> {
  const exists = await projectConfigExists();
  if (!exists) {
    return { label: "aitg.config.json", ok: false, detail: "not found -- run `aitg init`" };
  }
  try {
    const config = await readProjectConfig();
    return {
      label: "aitg.config.json",
      ok: true,
      detail: `project "${config.projectSlug}", min score ${config.minMutationScore}%`,
    };
  } catch (err) {
    return {
      label: "aitg.config.json",
      ok: false,
      detail: err instanceof Error ? err.message : "invalid config",
    };
  }
}

export async function doctorCommand(): Promise<void> {
  logger.title("aitg doctor");

  const checks = await Promise.all([
    checkNodeVersion(),
    checkGitInstalled(),
    checkIsGitRepo(),
    checkLoggedIn(),
    checkApiReachable(),
    checkProjectConfig(),
    checkTestRunner(),
  ]);

  for (const check of checks) {
    const icon = check.ok ? chalk.green("✓") : chalk.red("✗");
    console.log(`  ${icon} ${check.label.padEnd(32)} ${chalk.dim(check.detail)}`);
  }

  const failures = checks.filter((c) => !c.ok);
  console.log("");
  if (failures.length === 0) {
    logger.success("Everything looks good.");
  } else {
    logger.warn(`${failures.length} issue(s) found -- see above.`);
    process.exitCode = 1;
  }
}
