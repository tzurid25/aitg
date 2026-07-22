import simpleGit, { type SimpleGit } from "simple-git";
import { CliError } from "../lib/logger.js";
import { parseUnifiedDiff, countLines } from "./diff-parser.js";
import { shouldMutate } from "./file-filter.js";
import type { ChangedFile, ChangeKind, DiffOptions, DiffResult } from "./types.js";

/**
 * Resolves the merge-base between HEAD and the base ref. We diff against the
 * merge-base (three-dot semantics) rather than the tip of the base branch so
 * that commits landed on base *after* this branch diverged aren't attributed
 * to this change — otherwise every scan would inflate as the base moves.
 */
async function resolveMergeBase(git: SimpleGit, baseRef: string): Promise<string> {
  try {
    const result = await git.raw(["merge-base", baseRef, "HEAD"]);
    return result.trim();
  } catch {
    throw new CliError(
      `Could not find a common ancestor between HEAD and "${baseRef}".`,
      `Check that "${baseRef}" exists locally -- you may need to run \`git fetch\`.`,
    );
  }
}

async function resolveBaseRef(git: SimpleGit, requested?: string): Promise<string> {
  if (requested) {
    return requested;
  }

  // Prefer the remote's default branch as reported by origin/HEAD, falling
  // back to the conventional names before giving up.
  try {
    const symbolic = await git.raw(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    const ref = symbolic.trim().replace("refs/remotes/", "");
    if (ref) return ref;
  } catch {
    // origin/HEAD isn't set in every clone; fall through to the candidates.
  }

  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    try {
      await git.raw(["rev-parse", "--verify", candidate]);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new CliError(
    "Could not determine a base branch to diff against.",
    "Pass one explicitly with `aitg scan --base <branch>`.",
  );
}

function parseNameStatus(raw: string): Array<{ status: string; path: string; previousPath?: string }> {
  const entries: Array<{ status: string; path: string; previousPath?: string }> = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("\t");
    const status = parts[0];
    if (!status) continue;

    // Renames/copies come through as "R100\told\tnew".
    if (status.startsWith("R") || status.startsWith("C")) {
      const previousPath = parts[1];
      const path = parts[2];
      if (path && previousPath) {
        entries.push({ status: status[0] as string, path, previousPath });
      }
      continue;
    }

    const path = parts[1];
    if (path) {
      entries.push({ status: status[0] as string, path });
    }
  }

  return entries;
}

function toChangeKind(status: string): ChangeKind {
  switch (status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    default:
      return "modified";
  }
}

export async function analyzeDiff(options: DiffOptions): Promise<DiffResult> {
  const git = simpleGit(options.cwd ?? process.cwd());

  if (!(await git.checkIsRepo())) {
    throw new CliError(
      "This directory is not a git repository.",
      "Run `aitg scan` from inside your project's git repo.",
    );
  }

  const baseRef = await resolveBaseRef(git, options.baseRef);
  const baseSha = await resolveMergeBase(git, baseRef);
  const headSha = (await git.raw(["rev-parse", "HEAD"])).trim();
  const repoRoot = (await git.raw(["rev-parse", "--show-toplevel"])).trim();

  // When including uncommitted work we diff base..working-tree by omitting
  // the second revision; otherwise we pin to HEAD for a reproducible scan.
  const revisionArgs = options.includeUncommitted ? [baseSha] : [baseSha, headSha];

  const nameStatusRaw = await git.raw([
    "diff",
    "--name-status",
    "--find-renames",
    "--no-color",
    ...revisionArgs,
  ]);

  const entries = parseNameStatus(nameStatusRaw);

  const files: ChangedFile[] = [];
  const excludedPaths: string[] = [];

  for (const entry of entries) {
    const kind = toChangeKind(entry.status);

    // Deleted files have no post-image to mutate.
    if (kind === "deleted") {
      continue;
    }

    const decision = shouldMutate(entry.path, options.excludePatterns);
    if (!decision.include) {
      excludedPaths.push(entry.path);
      continue;
    }

    const fileDiff = await git.raw([
      "diff",
      "--unified=0",
      "--no-color",
      "--find-renames",
      ...revisionArgs,
      "--",
      // ":/" is git's root-relative pathspec magic. entry.path came out of
      // `--name-status`, which always reports paths relative to the repo
      // root — but this git process's cwd may be a subdirectory (e.g. a
      // package inside a monorepo). Without ":/", git re-resolves the path
      // relative to cwd instead, silently matches nothing, and the file
      // gets dropped here with no error and no entry in excludedPaths.
      // Verified: reproduces exactly this way when cwd is a package
      // subdirectory rather than the repo root.
      `:/${entry.path}`,
    ]);

    const changedRanges = parseUnifiedDiff(fileDiff);

    // A pure rename (or a mode-only change) yields no added lines — there is
    // nothing new to mutate, so it's dropped rather than reported as changed.
    if (changedRanges.length === 0) {
      continue;
    }

    files.push({
      path: entry.path,
      previousPath: entry.previousPath,
      kind,
      changedRanges,
      changedLineCount: countLines(changedRanges),
    });
  }

  return {
    baseSha,
    headSha,
    baseRef,
    repoRoot,
    files,
    excludedPaths,
    totalChangedLines: files.reduce((sum, f) => sum + f.changedLineCount, 0),
  };
}
