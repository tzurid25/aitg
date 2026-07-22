import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_CONFIG_FILE } from "./constants.js";
import { CliError } from "./logger.js";

export interface ProjectConfig {
  /** Which cloud Project this repo reports to (set by `aitg link`). */
  projectId: string;
  projectSlug: string;
  organizationSlug: string;

  /** Quality Gate defaults, overridable per-repo. Mirrors QualityGate in the DB schema. */
  minMutationScore: number;
  maxSurvivedMutants: number | null;
  failBuildOnBreach: boolean;

  /** Glob patterns excluded from mutation, e.g. generated code, migrations. */
  excludePatterns: string[];

  /** Schema version of this config file, so future CLI versions can migrate it safely. */
  configVersion: 1;
}

const DEFAULT_EXCLUDES = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/*.d.ts",
  "**/migrations/**",
];

export function defaultProjectConfig(params: {
  projectId: string;
  projectSlug: string;
  organizationSlug: string;
}): ProjectConfig {
  return {
    projectId: params.projectId,
    projectSlug: params.projectSlug,
    organizationSlug: params.organizationSlug,
    minMutationScore: 70,
    maxSurvivedMutants: null,
    failBuildOnBreach: true,
    excludePatterns: DEFAULT_EXCLUDES,
    configVersion: 1,
  };
}

function configPath(cwd: string = process.cwd()): string {
  return path.join(cwd, PROJECT_CONFIG_FILE);
}

export async function projectConfigExists(cwd?: string): Promise<boolean> {
  try {
    await fs.access(configPath(cwd));
    return true;
  } catch {
    return false;
  }
}

export async function writeProjectConfig(
  config: ProjectConfig,
  cwd?: string,
): Promise<void> {
  await fs.writeFile(configPath(cwd), JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export async function readProjectConfig(cwd?: string): Promise<ProjectConfig> {
  try {
    const raw = await fs.readFile(configPath(cwd), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;

    // Merge over defaults rather than casting.
    //
    // `as ProjectConfig` was a lie to the type system: aitg.config.json is a
    // file humans edit by hand, so any missing field surfaced as
    // "Cannot read properties of undefined" from deep inside the diff
    // engine. Filling defaults here means a partial config degrades to
    // sensible behaviour instead of an unattributable crash.
    return {
      projectId: parsed.projectId ?? "",
      projectSlug: parsed.projectSlug ?? "",
      organizationSlug: parsed.organizationSlug ?? "",
      minMutationScore: parsed.minMutationScore ?? 70,
      maxSurvivedMutants: parsed.maxSurvivedMutants ?? null,
      failBuildOnBreach: parsed.failBuildOnBreach ?? true,
      excludePatterns:
        Array.isArray(parsed.excludePatterns) && parsed.excludePatterns.length > 0
          ? parsed.excludePatterns
          : DEFAULT_EXCLUDES,
      configVersion: parsed.configVersion ?? 1,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CliError(
        `No ${PROJECT_CONFIG_FILE} found in this directory.`,
        "Run `aitg init` first, or `aitg link` if it's already registered in the cloud.",
      );
    }
    throw new CliError(
      `Could not parse ${PROJECT_CONFIG_FILE}: ${(err as Error).message}`,
    );
  }
}
