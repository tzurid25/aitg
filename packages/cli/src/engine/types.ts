/** A contiguous run of changed lines within a file, in post-image coordinates. */
export interface LineRange {
  /** 1-based, inclusive. */
  start: number;
  /** 1-based, inclusive. */
  end: number;
}

export type ChangeKind = "added" | "modified" | "renamed" | "deleted";

export interface ChangedFile {
  /** Repo-relative POSIX path in the post-image (the "new" path for renames). */
  path: string;
  /** Previous path, only set when kind === "renamed". */
  previousPath?: string;
  kind: ChangeKind;
  /**
   * Post-image line ranges that were added or modified. Empty for pure
   * deletions and for renames with no content change — Stryker has nothing
   * to mutate in either case.
   */
  changedRanges: LineRange[];
  /** Convenience: total changed lines across all ranges. */
  changedLineCount: number;
}

export interface DiffResult {
  /** Commit the diff was computed against (the merge-base). */
  baseSha: string;
  /** Commit representing the current working state. */
  headSha: string;
  baseRef: string;
  /**
   * Absolute path to the repo's top-level directory. `files[].path` is
   * relative to THIS, not to whatever `cwd` the diff was run from — needed
   * to convert back to cwd-relative paths when cwd is a subdirectory (e.g.
   * a package inside a monorepo).
   */
  repoRoot: string;
  /** Files that survived filtering and carry at least one changed line. */
  files: ChangedFile[];
  /** Files dropped by exclude patterns / test detection, for reporting. */
  excludedPaths: string[];
  totalChangedLines: number;
}

export interface DiffOptions {
  /** Branch/ref to diff against. Defaults to the repo's default branch. */
  baseRef?: string;
  /** Glob patterns to exclude, from aitg.config.json. */
  excludePatterns: string[];
  /** Include uncommitted working-tree changes in the diff. */
  includeUncommitted?: boolean;
  cwd?: string;
}
