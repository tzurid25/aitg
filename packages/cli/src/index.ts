import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { loginCommand } from "./commands/login.js";
import { linkCommand } from "./commands/link.js";
import { scanCommand } from "./commands/scan.js";
import { reportCommand } from "./commands/report.js";
import { doctorCommand } from "./commands/doctor.js";
import { updateCommand } from "./commands/update.js";
import { failAndExit } from "./lib/logger.js";
import { clearCredentials, loadCredentials } from "./lib/credentials.js";
import { logger } from "./lib/logger.js";

const program = new Command();

program
  .name("aitg")
  .description("AI Test Integrity Guard — mutation-tested quality gates for AI-generated code")
  .version(process.env.AITG_CLI_VERSION ?? "0.1.0");

program
  .command("login")
  .description("Authenticate this machine with your AITG account")
  .action(() => loginCommand().catch(failAndExit));

program
  .command("logout")
  .description("Remove stored credentials from this machine")
  .action(async () => {
    const creds = await loadCredentials();
    await clearCredentials();
    logger.success(creds ? `Logged out (${creds.userEmail}).` : "Already logged out.");
  });

program
  .command("init")
  .description("Set up AI Test Integrity Guard in the current repository")
  .option("-p, --project <slug>", "project slug to link this repo to")
  .option("-f, --force", "overwrite an existing aitg.config.json")
  .action((opts) => initCommand(opts).catch(failAndExit));

program
  .command("link")
  .description("(Re)link the current repository to a cloud project")
  .requiredOption("-p, --project <slug>", "project slug to link this repo to")
  .action((opts) => linkCommand(opts).catch(failAndExit));

program
  .command("scan")
  .description("Run a mutation-testing scan on changed code")
  .option("-b, --base <ref>", "branch/ref to diff against (defaults to the repo's default branch)")
  .option("-u, --uncommitted", "include uncommitted working-tree changes")
  .option("--dry-run", "analyze the diff and print the mutation surface without running mutations")
  .option("--no-upload", "skip uploading results to the cloud dashboard")
  .option("-c, --concurrency <n>", "number of parallel mutation workers")
  .action((opts) => scanCommand(opts).catch(failAndExit));

program
  .command("report")
  .description("Show the most recent local scan report")
  .option("--json", "output structured JSON instead of markdown")
  .action((opts) => reportCommand(opts).catch(failAndExit));

program
  .command("doctor")
  .description("Diagnose your local environment and configuration")
  .action(() => doctorCommand().catch(failAndExit));

program
  .command("update")
  .description("Check for and install the latest CLI version")
  .action(() => updateCommand().catch(failAndExit));

program.parseAsync(process.argv).catch(failAndExit);
