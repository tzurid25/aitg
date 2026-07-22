import chalk from "chalk";
import ora, { type Ora } from "ora";

export const logger = {
  info: (msg: string) => console.log(chalk.cyan("info"), msg),
  success: (msg: string) => console.log(chalk.green("✓"), msg),
  warn: (msg: string) => console.log(chalk.yellow("⚠"), msg),
  error: (msg: string) => console.error(chalk.red("✗"), msg),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  title: (msg: string) => console.log(chalk.bold.white(`\n${msg}`)),
  keyValue: (key: string, value: string) =>
    console.log(`  ${chalk.dim(key)} ${chalk.white(value)}`),
};

export function spinner(text: string): Ora {
  return ora({ text, color: "cyan" });
}

export class CliError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

/** Prints a CliError consistently and terminates the process. */
export function failAndExit(error: unknown): never {
  if (error instanceof CliError) {
    logger.error(error.message);
    if (error.hint) {
      logger.dim(`  → ${error.hint}`);
    }
    process.exit(error.exitCode);
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Unexpected error: ${message}`);
  process.exit(1);
}
