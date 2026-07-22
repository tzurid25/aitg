/**
 * Detects the CI environment so a scan can attach itself to the right pull
 * request.
 *
 * Read from environment variables rather than asking the user to configure
 * it: every CI provider already exports this, and a value the developer has
 * to remember to set is a value that will be wrong.
 */

export interface CiContext {
  isCi: boolean;
  provider: string | null;
  pullRequestNumber?: number;
  baseRef?: string;
}

function parsePrNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // GitHub Actions exposes refs like "refs/pull/42/merge" in some contexts
  // and a bare number in others. Accept both.
  const match = /(\d+)/.exec(value);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1] as string, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function detectCiContext(env: NodeJS.ProcessEnv = process.env): CiContext {
  // Explicit override first — set by our own workflow template, and the
  // escape hatch for providers we don't recognise.
  const explicit = parsePrNumber(env.AITG_PR_NUMBER);

  if (env.GITHUB_ACTIONS === "true") {
    return {
      isCi: true,
      provider: "github",
      pullRequestNumber: explicit ?? parsePrNumber(env.GITHUB_REF),
      baseRef: env.AITG_BASE_REF ?? env.GITHUB_BASE_REF,
    };
  }

  if (env.GITLAB_CI === "true") {
    return {
      isCi: true,
      provider: "gitlab",
      pullRequestNumber: explicit ?? parsePrNumber(env.CI_MERGE_REQUEST_IID),
      baseRef: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME,
    };
  }

  if (env.CIRCLECI === "true") {
    return {
      isCi: true,
      provider: "circleci",
      pullRequestNumber: explicit ?? parsePrNumber(env.CIRCLE_PULL_REQUEST),
    };
  }

  return {
    isCi: env.CI === "true",
    provider: null,
    pullRequestNumber: explicit,
    baseRef: env.AITG_BASE_REF,
  };
}
