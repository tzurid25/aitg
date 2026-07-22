import { matchesAnyGlob } from "./glob.js";

/**
 * Extensions StrykerJS can actually mutate. Anything else (markdown, JSON,
 * CSS, images, lockfiles) is dropped before line mapping — mutating them is
 * meaningless and would waste the user's quota.
 */
const MUTABLE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
]);

/**
 * Test files are excluded as *mutation targets* — they're the thing doing
 * the killing, not the thing being killed. Mutating a test file would
 * produce meaningless "surviving mutants" in assertions themselves.
 */
const TEST_PATH_PATTERNS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/test/**",
  "**/tests/**",
  "**/e2e/**",
  "**/cypress/**",
];

/** Never-mutate paths, regardless of user config. */
const ALWAYS_EXCLUDED = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/coverage/**",
  "**/*.d.ts",
  "**/*.config.*",
  "**/migrations/**",
];

function extensionOf(path: string): string {
  const lastDot = path.lastIndexOf(".");
  const lastSlash = path.lastIndexOf("/");
  if (lastDot <= lastSlash) return "";
  return path.slice(lastDot).toLowerCase();
}

export interface FilterDecision {
  include: boolean;
  reason?: "not-mutable-extension" | "test-file" | "always-excluded" | "user-excluded";
}

export function shouldMutate(path: string, userExcludePatterns: string[]): FilterDecision {
  if (!MUTABLE_EXTENSIONS.has(extensionOf(path))) {
    return { include: false, reason: "not-mutable-extension" };
  }

  if (matchesAnyGlob(path, ALWAYS_EXCLUDED)) {
    return { include: false, reason: "always-excluded" };
  }

  if (matchesAnyGlob(path, TEST_PATH_PATTERNS)) {
    return { include: false, reason: "test-file" };
  }

  if (matchesAnyGlob(path, userExcludePatterns)) {
    return { include: false, reason: "user-excluded" };
  }

  return { include: true };
}
