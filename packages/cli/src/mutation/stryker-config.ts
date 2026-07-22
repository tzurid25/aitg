import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { ScanTarget, TestRunner } from "./types.js";

/**
 * Stryker's `mutate` option accepts a "file:startLine-endLine" suffix, which
 * is the single most important cost lever we have: instead of mutating whole
 * files, we mutate only the exact ranges the Phase 3 diff engine identified.
 *
 * Example: "src/calc.ts:12-18"
 */
export function buildMutatePatterns(targets: ScanTarget[]): string[] {
  const patterns: string[] = [];

  for (const target of targets) {
    for (const range of target.ranges) {
      // Stryker expects POSIX separators even on Windows.
      const posixPath = target.path.split(path.sep).join("/");
      patterns.push(`${posixPath}:${range.start}-${range.end}`);
    }
  }

  return patterns;
}

/**
 * The subset of mutators that empirically catch the failure modes AI-written
 * tests exhibit (hard-coded expectations, missing boundary checks, assertions
 * that can't fail). Trimming from Stryker's full ~20 mutators cuts the mutant
 * count — and therefore run time and quota — substantially with little loss
 * in signal.
 */
export const HIGH_SIGNAL_MUTATORS = [
  "ConditionalExpression",
  "EqualityOperator",
  "BooleanLiteral",
  "LogicalOperator",
  "ArithmeticOperator",
  "UpdateOperator",
  "OptionalChaining",
];

export interface StrykerConfigParams {
  targets: ScanTarget[];
  testRunner: TestRunner;
  cwd: string;
  concurrency?: number;
  timeoutMs?: number;
  incremental?: boolean;
  /** Restrict to HIGH_SIGNAL_MUTATORS instead of Stryker's full set. */
  highSignalOnly?: boolean;
}

export interface StrykerRunConfig {
  mutate: string[];
  testRunner: string;
  coverageAnalysis: "perTest" | "off";
  concurrency: number;
  timeoutMS: number;
  incremental: boolean;
  incrementalFile: string;
  reporters: string[];
  jsonReporter: { fileName: string };
  mutator?: { excludedMutations?: string[] };
  disableTypeChecks: boolean;
  tempDirName: string;
  cleanTempDir: boolean;
  logLevel: string;
}

export const OUTPUT_DIR = ".test-guard";

export function buildStrykerConfig(params: StrykerConfigParams): StrykerRunConfig {
  const cpuCount = os.cpus().length || 2;
  const testRunner = params.testRunner === "unknown" ? "command" : params.testRunner;

  const config: StrykerRunConfig = {
    mutate: buildMutatePatterns(params.targets),
    testRunner,

    // Cost lever #1: only run the tests that actually cover each mutant,
    // instead of the whole suite per mutant. The command runner can't do
    // per-test coverage — it just re-runs the whole `npm test` per mutant —
    // so "perTest" there would make Stryker error out at startup.
    coverageAnalysis: testRunner === "command" ? "off" : "perTest",

    // Leave one core free so the developer's machine stays usable.
    concurrency: params.concurrency ?? Math.max(1, cpuCount - 1),

    // Cost lever #2: a mutant that induces an infinite loop must not pin a
    // worker indefinitely. Stryker adds its own baseline to this value.
    timeoutMS: params.timeoutMs ?? 10_000,

    // Cost lever #3: reuse results for files whose content and covering
    // tests are unchanged since the last run.
    incremental: params.incremental ?? true,
    incrementalFile: path.join(OUTPUT_DIR, "stryker-incremental.json"),

    reporters: ["json"],
    jsonReporter: { fileName: path.join(OUTPUT_DIR, "stryker-report.json") },

    // Type errors introduced by a mutation would otherwise be reported as
    // compile failures rather than killed mutants.
    disableTypeChecks: true,

    tempDirName: path.join(OUTPUT_DIR, ".stryker-tmp"),
    cleanTempDir: true,
    logLevel: "warn",
  };

  if (params.highSignalOnly) {
    // Stryker takes an exclusion list, so invert our allow-list.
    const ALL_MUTATORS = [
      ...HIGH_SIGNAL_MUTATORS,
      "StringLiteral",
      "ArrayDeclaration",
      "BlockStatement",
      "ObjectLiteral",
      "AssignmentOperator",
      "MethodExpression",
      "Regex",
      "UnaryOperator",
    ];
    config.mutator = {
      excludedMutations: ALL_MUTATORS.filter((m) => !HIGH_SIGNAL_MUTATORS.includes(m)),
    };
  }

  return config;
}

/**
 * Reads an existing stryker.conf.* if present. We merge our settings OVER the
 * project's config rather than replacing it, so a team with a tuned Stryker
 * setup (custom test command, plugins, ignore patterns) keeps it.
 */
export async function readExistingStrykerConfig(
  cwd: string,
): Promise<Record<string, unknown> | null> {
  const candidates = [
    "stryker.conf.json",
    "stryker.config.json",
    ".stryker.conf.json",
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(path.join(cwd, candidate), "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  return null;
}
