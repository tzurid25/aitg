export { analyzeDiff } from "./git-diff.js";
export { parseUnifiedDiff, countLines } from "./diff-parser.js";
export { shouldMutate } from "./file-filter.js";
export { matchesGlob, matchesAnyGlob } from "./glob.js";
export type {
  ChangedFile,
  ChangeKind,
  DiffOptions,
  DiffResult,
  LineRange,
} from "./types.js";
