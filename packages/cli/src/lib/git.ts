import simpleGit from "simple-git";
import { CliError } from "./logger.js";

export interface RepoIdentity {
  provider: "GITHUB" | "GITLAB" | "BITBUCKET" | "MANUAL";
  fullName: string; // e.g. "acme/api-service"
  defaultBranch: string;
}

/**
 * Reads the current repo's `origin` remote and the checked-out branch to
 * build a RepoIdentity the API can match/create a Repository record with.
 * This is intentionally shallow — full diff/changed-line analysis is a
 * Phase 3 concern (the mutation-scan git engine), not CLI foundation.
 */
export async function resolveRepoIdentity(cwd: string = process.cwd()): Promise<RepoIdentity> {
  const git = simpleGit(cwd);

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new CliError(
      "This directory is not a git repository.",
      "Run this command from inside your project's git repo.",
    );
  }

  const remotes = await git.getRemotes(true);
  const origin = remotes.find((r) => r.name === "origin");

  if (!origin?.refs?.fetch) {
    throw new CliError(
      "No 'origin' remote found.",
      "Add a remote with `git remote add origin <url>`, or link manually via the dashboard.",
    );
  }

  const { provider, fullName } = parseRemoteUrl(origin.refs.fetch);

  let defaultBranch: string;
  try {
    const status = await git.status();
    defaultBranch = status.tracking?.split("/").slice(1).join("/") || status.current || "main";
  } catch {
    defaultBranch = "main";
  }

  return { provider, fullName, defaultBranch };
}

function parseRemoteUrl(url: string): { provider: RepoIdentity["provider"]; fullName: string } {
  // Handles both SSH ("git@github.com:org/repo.git") and HTTPS
  // ("https://github.com/org/repo.git") remote URL formats.
  const sshMatch = url.match(/^git@([^:]+):(.+?)(\.git)?$/);
  const httpsMatch = url.match(/^https?:\/\/([^/]+)\/(.+?)(\.git)?$/);

  const match = sshMatch ?? httpsMatch;
  if (!match) {
    throw new CliError(`Could not parse remote URL: ${url}`);
  }

  const [, host, fullName] = match;
  // Both groups are non-optional in the patterns above, so a successful match
  // implies both are present. Checking anyway keeps a malformed URL on the
  // same clear error path as an unparseable one, instead of crashing later.
  if (!host || !fullName) {
    throw new CliError(`Could not parse remote URL: ${url}`);
  }

  const provider: RepoIdentity["provider"] = host.includes("github.com")
    ? "GITHUB"
    : host.includes("gitlab.com")
      ? "GITLAB"
      : host.includes("bitbucket.org")
        ? "BITBUCKET"
        : "MANUAL";

  return { provider, fullName };
}
