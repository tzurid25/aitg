import { createRequire } from "node:module";

// libsodium-wrappers' ESM build is broken: dist/modules-esm/
// libsodium-wrappers.mjs imports "./libsodium.mjs", which the package does
// not ship (verified against a clean npm install, so this is not a pnpm
// artifact). Bundlers and Node's ESM loader both fail on it, which took down
// the whole `apps/web` build and would have failed at runtime when sealing a
// secret.
//
// The CJS build is complete and correct, so we load that explicitly. The
// crypto below is unchanged.
const require = createRequire(import.meta.url);
const _sodium = require("libsodium-wrappers") as typeof import("libsodium-wrappers");
import { githubRequest } from "./client";

/**
 * One-click workflow setup.
 *
 * Manually, connecting a repository takes four steps: create a file, commit
 * it, generate an API key, paste it into repository secrets. Four steps is
 * where trial users quit — and every one of them is something we can do with
 * permissions the installation already granted.
 *
 * So this does the work and hands back a pull request. The developer reviews
 * a diff, which is the interaction they already trust, and merges. Two steps
 * instead of four, and nothing happens to their default branch without
 * approval.
 */

const WORKFLOW_PATH = ".github/workflows/aitg.yml";
const BRANCH_NAME = "aitg/add-mutation-gate";
const SECRET_NAME = "AITG_API_KEY";

function buildWorkflow(): string {
  return `# AI Test Integrity Guard — mutation quality gate
#
# The scan runs on this runner, not on AITG's servers. Your source code never
# leaves your CI; only the resulting report (file paths, line numbers, and
# mutation outcomes) is uploaded.

name: Mutation quality gate

on:
  pull_request:
    types: [opened, reopened, synchronize]

jobs:
  mutation-score:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4
        with:
          # AITG diffs against the base branch. A shallow clone has no merge
          # base to diff against, so full history is required.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - name: Install AITG
        run: npm install -g @aitg/cli

      - name: Run mutation scan
        env:
          AITG_API_KEY: \${{ secrets.${SECRET_NAME} }}
          AITG_PR_NUMBER: \${{ github.event.pull_request.number }}
        run: aitg scan --base "origin/\${{ github.event.pull_request.base.ref }}"
`;
}

/**
 * Encrypts a value for GitHub Actions secrets.
 *
 * GitHub requires a libsodium sealed box against the repository's public key
 * — the plaintext must never touch their API. Sealed boxes are anonymous:
 * we can write a secret we cannot read back, which is the correct property
 * here.
 */
async function encryptSecret(publicKeyBase64: string, value: string): Promise<string> {
  await _sodium.ready;
  const sodium = _sodium;

  const keyBytes = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const valueBytes = sodium.from_string(value);
  const sealed = sodium.crypto_box_seal(valueBytes, keyBytes);

  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
}

export interface SetupResult {
  pullRequestUrl: string;
  secretConfigured: boolean;
  /** Set when the workflow already existed and no PR was needed. */
  alreadyPresent?: boolean;
}

export async function setupRepositoryWorkflow(params: {
  installationId: string;
  fullName: string;
  apiKey: string;
}): Promise<SetupResult> {
  const { installationId, fullName, apiKey } = params;

  // ---- 1. Secret ----------------------------------------------------------
  // Done first. If it fails, we stop before opening a pull request whose
  // workflow could only fail on its first run.
  const publicKey = await githubRequest<{ key: string; key_id: string }>({
    installationId,
    path: `/repos/${fullName}/actions/secrets/public-key`,
  });

  await githubRequest({
    installationId,
    method: "PUT",
    path: `/repos/${fullName}/actions/secrets/${SECRET_NAME}`,
    body: {
      encrypted_value: await encryptSecret(publicKey.key, apiKey),
      key_id: publicKey.key_id,
    },
  });

  // ---- 2. Is the workflow already there? ----------------------------------
  const repo = await githubRequest<{ default_branch: string }>({
    installationId,
    path: `/repos/${fullName}`,
  });

  try {
    await githubRequest({
      installationId,
      path: `/repos/${fullName}/contents/${encodeURIComponent(WORKFLOW_PATH)}?ref=${repo.default_branch}`,
    });

    // It exists. Rewriting someone's CI config uninvited would be
    // presumptuous — the secret is now set, which is the part they cannot
    // easily do themselves.
    return {
      pullRequestUrl: `https://github.com/${fullName}/blob/${repo.default_branch}/${WORKFLOW_PATH}`,
      secretConfigured: true,
      alreadyPresent: true,
    };
  } catch {
    // 404 is the expected path: no workflow yet.
  }

  // ---- 3. Branch ----------------------------------------------------------
  const baseRef = await githubRequest<{ object: { sha: string } }>({
    installationId,
    path: `/repos/${fullName}/git/ref/heads/${repo.default_branch}`,
  });

  const branch = `${BRANCH_NAME}-${Date.now().toString(36)}`;

  await githubRequest({
    installationId,
    method: "POST",
    path: `/repos/${fullName}/git/refs`,
    body: { ref: `refs/heads/${branch}`, sha: baseRef.object.sha },
  });

  // ---- 4. Commit ----------------------------------------------------------
  await githubRequest({
    installationId,
    method: "PUT",
    path: `/repos/${fullName}/contents/${encodeURIComponent(WORKFLOW_PATH)}`,
    body: {
      message: "ci: add mutation quality gate",
      content: Buffer.from(buildWorkflow(), "utf8").toString("base64"),
      branch,
    },
  });

  // ---- 5. Pull request ----------------------------------------------------
  const pr = await githubRequest<{ html_url: string }>({
    installationId,
    method: "POST",
    path: `/repos/${fullName}/pulls`,
    body: {
      title: "Add mutation quality gate",
      head: branch,
      base: repo.default_branch,
      body: [
        "This adds a mutation-testing check to pull requests.",
        "",
        "**What it does.** On every PR, it mutates only the lines you changed —",
        "flipping conditions, inverting comparisons, altering arithmetic — and",
        "re-runs your test suite. A mutation that survives is code your tests",
        "execute but never actually verify.",
        "",
        "**Where it runs.** On this repository's own runner. Source code is never",
        "uploaded; only the report (file paths, line numbers, mutation outcomes)",
        "is sent to AITG.",
        "",
        `**Secret.** \`${SECRET_NAME}\` has already been added to this repository's`,
        "Actions secrets. No further setup is needed.",
        "",
        "**Cost.** Only changed lines are mutated, so a typical PR adds a couple of",
        "minutes rather than re-testing the whole codebase.",
        "",
        "---",
        "",
        "<sub>Coverage is not quality. Mutation score is.</sub>",
      ].join("\n"),
    },
  });

  return { pullRequestUrl: pr.html_url, secretConfigured: true };
}

/** Repositories this installation can reach, for the setup picker. */
export async function listInstallationRepositories(
  installationId: string,
): Promise<Array<{ fullName: string; defaultBranch: string; private: boolean }>> {
  const result = await githubRequest<{
    repositories: Array<{ full_name: string; default_branch: string; private: boolean }>;
  }>({
    installationId,
    path: "/installation/repositories?per_page=100",
  });

  return result.repositories.map((repo) => ({
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
  }));
}
