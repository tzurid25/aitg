import type { LineRange } from "./types.js";

/**
 * Parses a unified diff for a single file and returns the post-image line
 * ranges that were added or modified.
 *
 * Hunk header grammar:  @@ -oldStart,oldCount +newStart,newCount @@
 * The count is omitted when it equals 1, hence the optional group.
 *
 * Within a hunk body we only advance the post-image counter for context
 * (" ") and addition ("+") lines. Deletions ("-") exist only in the
 * pre-image and therefore contribute no mutable line.
 */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(diffText: string): LineRange[] {
  const ranges: LineRange[] = [];
  const lines = diffText.split("\n");

  let newLineNumber = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  let inHunk = false;

  const flush = () => {
    if (currentStart !== null && currentEnd !== null) {
      ranges.push({ start: currentStart, end: currentEnd });
    }
    currentStart = null;
    currentEnd = null;
  };

  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      flush();
      inHunk = true;
      newLineNumber = parseInt(header[1] as string, 10);
      continue;
    }

    if (!inHunk) continue;

    // A new "diff --git" section means this file's hunks are done.
    if (line.startsWith("diff --git")) {
      flush();
      inHunk = false;
      continue;
    }

    const marker = line[0];

    if (marker === "+") {
      if (currentStart === null) {
        currentStart = newLineNumber;
      }
      currentEnd = newLineNumber;
      newLineNumber++;
      continue;
    }

    if (marker === "-") {
      // Pre-image only; post-image line numbering does not advance.
      continue;
    }

    if (marker === " ") {
      // Context line terminates any run of additions.
      flush();
      newLineNumber++;
      continue;
    }

    // "\ No newline at end of file" and any other metadata line.
    if (line.startsWith("\\")) {
      continue;
    }

    // Blank trailing line in the diff output.
    if (line === "") {
      continue;
    }
  }

  flush();
  return mergeAdjacent(ranges);
}

/** Collapses ranges that touch or overlap, so Stryker gets a clean span list. */
function mergeAdjacent(ranges: LineRange[]): LineRange[] {
  if (ranges.length <= 1) return ranges;

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [];

  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  return merged;
}

export function countLines(ranges: LineRange[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}
