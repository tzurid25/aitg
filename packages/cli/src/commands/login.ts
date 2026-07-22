import chalk from "chalk";
import { ApiClient } from "../lib/api-client.js";
import { saveCredentials } from "../lib/credentials.js";
import { logger, spinner, CliError } from "../lib/logger.js";
import { tryOpenBrowser } from "../lib/open-browser.js";

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — matches typical device-code UX elsewhere (gh, npm)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loginCommand(): Promise<void> {
  const api = new ApiClient();

  logger.title("Log in to AI Test Integrity Guard");

  const start = await api.startDeviceAuth();

  console.log(`\n  First, copy this code: ${chalk.bold.cyan(start.userCode)}`);
  console.log(`  Then open: ${chalk.underline(start.verificationUrl)}\n`);
  tryOpenBrowser(start.verificationUrl);

  const spin = spinner("Waiting for confirmation in the browser...").start();

  const deadline = Date.now() + Math.min(POLL_TIMEOUT_MS, start.expiresInSeconds * 1000);
  const intervalMs = Math.max(1000, start.pollIntervalSeconds * 1000);

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    const result = await api.pollDeviceAuth(start.deviceCode);

    if (result.status === "expired") {
      spin.fail("The login code expired.");
      throw new CliError("Login timed out.", "Run `aitg login` again.");
    }

    if (result.status === "approved") {
      if (!result.apiKey || !result.organizationId || !result.organizationSlug || !result.userEmail) {
        spin.fail("Login approved, but the server response was incomplete.");
        throw new CliError("Unexpected response from the AITG API during login.");
      }

      await saveCredentials({
        apiKey: result.apiKey,
        organizationId: result.organizationId,
        organizationSlug: result.organizationSlug,
        userEmail: result.userEmail,
        createdAt: new Date().toISOString(),
      });

      spin.succeed(`Logged in as ${chalk.bold(result.userEmail)} (${result.organizationSlug})`);
      return;
    }

    // status === "pending" -> keep polling
  }

  spin.fail("Timed out waiting for login confirmation.");
  throw new CliError("Login timed out.", "Run `aitg login` again.");
}
