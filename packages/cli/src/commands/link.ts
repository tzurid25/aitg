import chalk from "chalk";
import { ApiClient } from "../lib/api-client.js";
import { requireCredentials } from "../lib/credentials.js";
import { resolveRepoIdentity } from "../lib/git.js";
import { readProjectConfig, writeProjectConfig, projectConfigExists, defaultProjectConfig } from "../lib/config.js";
import { logger, spinner, CliError } from "../lib/logger.js";

export interface LinkOptions {
  project: string; // required — this command always targets an explicit project
}

export async function linkCommand(options: LinkOptions): Promise<void> {
  if (!options.project) {
    throw new CliError(
      "You must specify a project.",
      "Usage: aitg link --project <slug>",
    );
  }

  logger.title(`Link this repository to "${options.project}"`);

  const creds = await requireCredentials();
  const api = ApiClient.forAuthenticatedUser(creds);

  const identitySpin = spinner("Reading repository info...").start();
  const identity = await resolveRepoIdentity();
  identitySpin.succeed(`Detected repository: ${chalk.bold(identity.fullName)}`);

  const linkSpin = spinner(`Linking to project "${options.project}"...`).start();
  const link = await api.linkRepository({
    projectSlug: options.project,
    fullName: identity.fullName,
    defaultBranch: identity.defaultBranch,
    provider: identity.provider,
  });
  linkSpin.succeed("Repository linked.");

  // Preserve existing thresholds/excludes if a config already exists —
  // `link` re-targets a project, it doesn't reset local quality settings.
  const existing = (await projectConfigExists())
    ? await readProjectConfig()
    : defaultProjectConfig({
        projectId: link.project.id,
        projectSlug: link.project.slug,
        organizationSlug: creds.organizationSlug,
      });

  await writeProjectConfig({
    ...existing,
    projectId: link.project.id,
    projectSlug: link.project.slug,
    organizationSlug: creds.organizationSlug,
  });

  logger.success(`Now reporting to project "${link.project.slug}".`);
}
