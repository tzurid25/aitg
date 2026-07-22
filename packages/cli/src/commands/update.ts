import { exec } from "node:child_process";
import { promisify } from "node:util";
import axios from "axios";
import chalk from "chalk";
import { logger, spinner } from "../lib/logger.js";
import { PACKAGE_NAME } from "../lib/constants.js";

const execAsync = promisify(exec);

/** Reads the version this running CLI was built with (injected at build time by tsup via package.json). */
function getCurrentVersion(): string {
  // Populated from package.json at publish time; see packages/cli/package.json "version".
  // Read via env instead of importing package.json directly to keep the ESM build simple.
  return process.env.AITG_CLI_VERSION ?? "0.1.0";
}

/** Minimal semver comparison — avoids pulling in a dependency for 3 integers. */
function isNewer(remote: string, local: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const [rMajor, rMinor, rPatch] = parse(remote);
  const [lMajor, lMinor, lPatch] = parse(local);

  if (rMajor !== lMajor) return rMajor > lMajor;
  if (rMinor !== lMinor) return rMinor > lMinor;
  return rPatch > lPatch;
}

export async function updateCommand(): Promise<void> {
  logger.title("Check for updates");

  const current = getCurrentVersion();
  const spin = spinner("Checking npm for the latest version...").start();

  let latest: string;
  try {
    const { data } = await axios.get<{ version: string }>(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { timeout: 10_000 },
    );
    latest = data.version;
  } catch {
    spin.fail("Could not reach the npm registry.");
    return;
  }

  if (!isNewer(latest, current)) {
    spin.succeed(`You're up to date (${chalk.bold(current)}).`);
    return;
  }

  spin.warn(`A new version is available: ${chalk.bold(current)} → ${chalk.bold.green(latest)}`);

  const installSpin = spinner(`Installing ${PACKAGE_NAME}@${latest}...`).start();
  try {
    await execAsync(`npm install -g ${PACKAGE_NAME}@latest`);
    installSpin.succeed(`Updated to ${latest}.`);
  } catch (err) {
    installSpin.fail("Automatic update failed.");
    logger.dim(`  Run manually: npm install -g ${PACKAGE_NAME}@latest`);
    logger.dim(`  (${err instanceof Error ? err.message : String(err)})`);
  }
}
