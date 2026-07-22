import chalk from "chalk";
import { ApiClient } from "../lib/api-client.js";
import { requireCredentials } from "../lib/credentials.js";
import { resolveRepoIdentity } from "../lib/git.js";
import { defaultProjectConfig, projectConfigExists, writeProjectConfig } from "../lib/config.js";
import { logger, spinner, CliError } from "../lib/logger.js";
import { PROJECT_CONFIG_FILE } from "../lib/constants.js";

export interface InitOptions {
  project?: string;
  force?: boolean;
  /** Set up for local-only use, with no cloud account or network access. */
  local?: boolean;
}

/**
 * Marks a config as local-only. `scan` already works offline (it just skips
 * the upload when there are no credentials), so local mode is purely about
 * not making an account a prerequisite for trying the tool.
 */
const LOCAL_SENTINEL = "local";

export async function initCommand(options: InitOptions): Promise<void> {
  logger.title("Initialize AI Test Integrity Guard");

  if (!options.force && (await projectConfigExists())) {
    throw new CliError(
      `${PROJECT_CONFIG_FILE} already exists in this directory.`,
      "Pass --force to overwrite it, or use `aitg link` to point it at a different project.",
    );
  }

  // Local mode: no credentials, no API calls, no account. A developer
  // evaluating the tool should be able to get a mutation score on their own
  // code before deciding whether it's worth signing up for anything.
  if (options.local) {
    const config = defaultProjectConfig({
      projectId: LOCAL_SENTINEL,
      projectSlug: LOCAL_SENTINEL,
      organizationSlug: LOCAL_SENTINEL,
    });
    await writeProjectConfig(config);

    logger.success(`Created ${PROJECT_CONFIG_FILE} (local mode)`);
    logger.dim(`  Minimum mutation score: ${config.minMutationScore}%`);
    logger.dim(`  Fail build on breach:   ${config.failBuildOnBreach}`);
    logger.dim("  Results stay on this machine; nothing is uploaded.");
    console.log(`\nNext: run ${chalk.bold.cyan("aitg scan")} to run your first scan.`);
    console.log(
      chalk.dim(`Later, \`aitg login\` then \`aitg init --force\` will connect this repo to the cloud.`),
    );
    return;
  }

  const creds = await requireCredentials().catch(() => {
    // Signing up is a reasonable ask for a team adopting the tool, but not
    // for someone trying it for the first time. Name the offline path here
    // rather than leaving "run `aitg login`" as the only way forward.
    throw new CliError(
      "Not logged in.",
      "Run `aitg init --local` to use AITG offline (no account needed),\n" +
        "   or `aitg login` to connect this repo to the cloud dashboard.",
    );
  });
  const api = ApiClient.forAuthenticatedUser(creds);

  const identitySpin = spinner("Reading repository info...").start();
  const identity = await resolveRepoIdentity();
  identitySpin.succeed(`Detected repository: ${chalk.bold(identity.fullName)}`);

  const projectsSpin = spinner("Fetching projects...").start();
  const projects = await api.listProjects();
  projectsSpin.stop();

  let selected = options.project
    ? projects.find((p) => p.slug === options.project)
    : projects.length === 1
      ? projects[0]
      : undefined;

  if (!selected) {
    if (projects.length === 0) {
      throw new CliError(
        `No projects found in organization "${creds.organizationSlug}".`,
        `Create one first at ${chalk.underline("https://app.aitg.dev")}, then re-run \`aitg init\`.`,
      );
    }
    const list = projects.map((p) => `  - ${p.slug}`).join("\n");
    throw new CliError(
      "Multiple projects found -- you must specify one.",
      `Re-run with --project <slug>. Available projects:\n${list}`,
    );
  }

  const linkSpin = spinner(`Linking to project "${selected.slug}"...`).start();
  const link = await api.linkRepository({
    projectSlug: selected.slug,
    fullName: identity.fullName,
    defaultBranch: identity.defaultBranch,
    provider: identity.provider,
  });
  linkSpin.succeed("Repository linked.");

  const config = defaultProjectConfig({
    projectId: link.project.id,
    projectSlug: link.project.slug,
    organizationSlug: creds.organizationSlug,
  });
  await writeProjectConfig(config);

  logger.success(`Created ${PROJECT_CONFIG_FILE}`);
  logger.dim(`  Minimum mutation score: ${config.minMutationScore}%`);
  logger.dim(`  Fail build on breach:   ${config.failBuildOnBreach}`);
  console.log(`\nNext: run ${chalk.bold.cyan("aitg scan")} to run your first scan.`);
}
