import type { LineRange } from "../engine/types.js";

/** Mirrors MutantStatus in the Prisma schema. */
export type MutantStatus =
  | "KILLED"
  | "SURVIVED"
  | "TIMEOUT"
  | "NO_COVERAGE"
  | "RUNTIME_ERROR"
  | "IGNORED";

export interface MutantResult {
  id: string;
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  mutatorName: string;
  status: MutantStatus;
  originalCode?: string;
  mutatedCode?: string;
  /** Name of the test that killed this mutant, when Stryker reports one. */
  killedByTest?: string;
}

export interface MutationScore {
  /**
   * Stryker's "mutation score based on covered code": killed / (killed +
   * survived + timeout). Excludes NO_COVERAGE, matching the industry
   * convention so our number is comparable to a standalone Stryker run.
   */
  score: number;
  total: number;
  killed: number;
  survived: number;
  timedOut: number;
  noCoverage: number;
  runtimeErrors: number;
  ignored: number;
}

export interface ScanTarget {
  path: string;
  ranges: LineRange[];
}

export interface MutationRunResult {
  score: MutationScore;
  mutants: MutantResult[];
  /** Mutants that survived — the actionable output. */
  survivors: MutantResult[];
  durationMs: number;
  testRunner: TestRunner;
}

export type TestRunner = "jest" | "vitest" | "mocha" | "jasmine" | "tap" | "command" | "unknown";

export interface MutationRunOptions {
  targets: ScanTarget[];
  cwd: string;
  /** Fed straight into Stryker's `concurrency`. Defaults to cpus-1. */
  concurrency?: number;
  /** Per-mutant timeout in ms. Guards against mutants that induce infinite loops. */
  timeoutMs?: number;
  incremental?: boolean;
}
