import fs from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import { LOCAL_OUTPUT_DIR } from "../lib/constants.js";
import { logger, CliError } from "../lib/logger.js";

const REPORT_FILENAME = "report.md";

export interface ReportOptions {
  json?: boolean;
}

export async function reportCommand(options: ReportOptions): Promise<void> {
  const reportPath = path.join(process.cwd(), LOCAL_OUTPUT_DIR, REPORT_FILENAME);
  const fixPromptPath = path.join(process.cwd(), LOCAL_OUTPUT_DIR, "fix-prompt.md");

  let report: string;
  try {
    report = await fs.readFile(reportPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        "No local scan report found.",
        "Run `aitg scan` first.",
      );
    }
    throw err;
  }

  if (options.json) {
    // The markdown report has no structured JSON sibling yet — that lands
    // with the Phase 4 mutation engine, which is what actually produces
    // structured mutant-level data. Fail clearly instead of guessing.
    // Stryker's own structured output is the source of truth here; we don't
    // re-serialize the markdown, because that would be a lossy round trip.
    const strykerReportPath = path.join(process.cwd(), LOCAL_OUTPUT_DIR, "stryker-report.json");
    try {
      const raw = await fs.readFile(strykerReportPath, "utf-8");
      console.log(raw);
      return;
    } catch {
      throw new CliError(
        "No structured report found.",
        "Run `aitg scan` first - the JSON report is written alongside report.md.",
      );
    }
  }

  logger.title("Latest scan report");
  console.log(report);

  const hasFixPrompt = await fs
    .access(fixPromptPath)
    .then(() => true)
    .catch(() => false);

  if (hasFixPrompt) {
    console.log(chalk.dim(`\nAI fix prompt available at: ${fixPromptPath}`));
  }
}
