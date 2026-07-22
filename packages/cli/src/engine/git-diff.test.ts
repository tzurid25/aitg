import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeDiff } from "./git-diff.js";

/**
 * These build a real git repository per test rather than mocking simple-git.
 *
 * That matters here specifically: bugs #5 and #6 in KNOWN-ISSUES.md were both
 * about how git itself resolves pathspecs relative to a process's cwd. A
 * mocked git would have happily returned the paths we told it to return, and
 * both bugs would have sailed through a green suite. The only way to catch
 * them is to make git do the work.
 */
let repo: string;

function git(args: string[], cwd = repo): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" });
}

async function write(relativePath: string, contents: string): Promise<void> {
  const full = path.join(repo, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents, "utf-8");
}

beforeEach(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "aitg-diff-"));
  git(["init", "-q", "--initial-branch=main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
});

afterEach(async () => {
  await fs.rm(repo, { recursive: true, force: true });
});

const opts = (over: Partial<Parameters<typeof analyzeDiff>[0]> = {}) => ({
  excludePatterns: ["**/*.test.*", "**/node_modules/**"],
  baseRef: "main",
  cwd: repo,
  ...over,
});

describe("analyzeDiff", () => {
  it("reports a modified file with its changed line ranges", async () => {
    await write("src/calc.ts", "export const a = 1;\nexport const b = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("src/calc.ts", "export const a = 1;\nexport const b = 99;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "change"]);

    const result = await analyzeDiff(opts());

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("src/calc.ts");
    expect(result.files[0]?.kind).toBe("modified");
    expect(result.files[0]?.changedRanges).toEqual([{ start: 2, end: 2 }]);
    expect(result.totalChangedLines).toBe(1);
  });

  // --- Bug #5: pathspec resolved against cwd instead of the repo root ----
  //
  // Running from a package subdirectory made git look for
  // `packages/cli/packages/cli/src/...`, match nothing, and drop the file
  // silently. The scan reported "nothing to scan" on a branch with real
  // changes. Only reproducible when cwd is NOT the repo root.

  it("finds changed files when run from a subdirectory of the repo", async () => {
    await write("packages/cli/src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("packages/cli/src/calc.ts", "export const a = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "change"]);

    const result = await analyzeDiff(opts({ cwd: path.join(repo, "packages/cli") }));

    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.changedRanges).toEqual([{ start: 1, end: 1 }]);
  });

  it("reports paths relative to the repo root even when run from a subdirectory", async () => {
    await write("packages/cli/src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("packages/cli/src/calc.ts", "export const a = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "change"]);

    const result = await analyzeDiff(opts({ cwd: path.join(repo, "packages/cli") }));

    // scan.ts relies on this convention to re-anchor paths for Stryker.
    expect(result.files[0]?.path).toBe("packages/cli/src/calc.ts");
  });

  // --- Bug #6 support: repoRoot must be present and correct -------------

  it("returns the repo root so callers can re-anchor paths", async () => {
    await write("packages/cli/src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
    git(["checkout", "-qb", "feature"]);
    await write("packages/cli/src/calc.ts", "export const a = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "change"]);

    const sub = path.join(repo, "packages/cli");
    const result = await analyzeDiff(opts({ cwd: sub }));

    expect(result.repoRoot).toBeTruthy();
    // Resolve both sides: macOS reports /private/var for /var.
    const resolved = await fs.realpath(result.repoRoot);
    expect(await fs.realpath(repo)).toBe(resolved);

    // The re-anchoring scan.ts performs must land on the file on disk.
    const rebased = path.relative(sub, path.join(result.repoRoot, result.files[0]!.path));
    await expect(fs.access(path.join(sub, rebased))).resolves.toBeUndefined();
  });

  // --- Filtering ---------------------------------------------------------

  it("excludes test files from the mutation surface", async () => {
    await write("src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("src/calc.ts", "export const a = 2;\n");
    await write("src/calc.test.ts", "test('x', () => {});\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "change"]);

    const result = await analyzeDiff(opts());

    expect(result.files.map((f) => f.path)).toEqual(["src/calc.ts"]);
    expect(result.excludedPaths).toContain("src/calc.test.ts");
  });

  it("reports no files when only excluded paths changed", async () => {
    await write("src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("src/calc.test.ts", "test('x', () => {});\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "tests only"]);

    const result = await analyzeDiff(opts());

    expect(result.files).toHaveLength(0);
    expect(result.excludedPaths.length).toBeGreaterThan(0);
  });

  it("skips deleted files, which have no post-image to mutate", async () => {
    await write("src/gone.ts", "export const a = 1;\n");
    await write("src/stays.ts", "export const b = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await fs.rm(path.join(repo, "src/gone.ts"));
    await write("src/stays.ts", "export const b = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "delete one"]);

    const result = await analyzeDiff(opts());

    expect(result.files.map((f) => f.path)).toEqual(["src/stays.ts"]);
  });

  it("includes added files in full", async () => {
    await write("src/existing.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("src/added.ts", "export const x = 1;\nexport const y = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "add file"]);

    const result = await analyzeDiff(opts());

    const added = result.files.find((f) => f.path === "src/added.ts");
    expect(added?.kind).toBe("added");
    expect(added?.changedLineCount).toBe(2);
  });

  it("returns no files when nothing changed", async () => {
    await write("src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);
    git(["checkout", "-qb", "feature"]);

    const result = await analyzeDiff(opts());

    expect(result.files).toHaveLength(0);
    expect(result.totalChangedLines).toBe(0);
  });

  it("diffs against the merge-base, not the tip of the base branch", async () => {
    // Otherwise commits landing on main after the branch diverged get
    // attributed to this change, and every scan inflates as main moves.
    //
    // The base commit must MODIFY a file the branch also has, not add a new
    // one: against the branch tip an added file shows up as a deletion, which
    // analyzeDiff skips anyway — so the two strategies would produce the same
    // visible result and the assertion would pass either way. (This test
    // originally had exactly that flaw and survived a deliberate mutation.)
    await write("src/calc.ts", "export const a = 1;\n");
    await write("src/shared.ts", "export const s = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    await write("src/calc.ts", "export const a = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "my change"]);

    git(["checkout", "-q", "main"]);
    await write("src/shared.ts", "export const s = 2;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "someone else's change to a shared file"]);
    git(["checkout", "-q", "feature"]);

    const result = await analyzeDiff(opts());

    // Against the merge-base: only our own change. Against main's tip,
    // shared.ts would appear modified too, and be wrongly attributed here.
    expect(result.files.map((f) => f.path)).toEqual(["src/calc.ts"]);
  });

  it("reports several ranges for edits far apart in one file", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i};`).join("\n");
    await write("src/many.ts", `${lines}\n`);
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    git(["checkout", "-qb", "feature"]);
    const edited = lines.split("\n");
    edited[1] = "const v1 = 111;";
    edited[15] = "const v15 = 999;";
    await write("src/many.ts", `${edited.join("\n")}\n`);
    git(["add", "-A"]);
    git(["commit", "-qm", "two edits"]);

    const result = await analyzeDiff(opts());

    expect(result.files[0]?.changedRanges).toEqual([
      { start: 2, end: 2 },
      { start: 16, end: 16 },
    ]);
  });

  it("fails with a clear message outside a git repository", async () => {
    const notRepo = await fs.mkdtemp(path.join(os.tmpdir(), "aitg-notrepo-"));
    try {
      await expect(analyzeDiff(opts({ cwd: notRepo }))).rejects.toThrow(/not a git repository/i);
    } finally {
      await fs.rm(notRepo, { recursive: true, force: true });
    }
  });

  it("fails with a clear message for a base ref that does not exist", async () => {
    await write("src/calc.ts", "export const a = 1;\n");
    git(["add", "-A"]);
    git(["commit", "-qm", "init"]);

    await expect(analyzeDiff(opts({ baseRef: "no-such-branch" }))).rejects.toThrow();
  });
});
