import fs from "node:fs/promises";
import path from "node:path";
import type { TestRunner } from "./types.js";

/**
 * Stryker needs to know which test runner plugin to load. We detect it from
 * the project's dependencies rather than prompting, because the activation
 * target is "value in under 10 minutes" and every config question is friction.
 *
 * Order matters: vitest is checked before jest because projects migrating
 * from jest often still have jest in devDependencies alongside vitest.
 */
const DETECTION_ORDER: Array<{ runner: TestRunner; packages: string[] }> = [
  { runner: "vitest", packages: ["vitest"] },
  { runner: "jest", packages: ["jest", "@jest/core", "ts-jest"] },
  { runner: "mocha", packages: ["mocha"] },
  { runner: "jasmine", packages: ["jasmine", "jasmine-core"] },
  { runner: "tap", packages: ["tap", "node-tap"] },
];

export interface DetectedRunner {
  runner: TestRunner;
  /** The npm package name of the Stryker plugin required for this runner. */
  strykerPlugin: string | null;
}

const PLUGIN_BY_RUNNER: Record<TestRunner, string | null> = {
  vitest: "@stryker-mutator/vitest-runner",
  jest: "@stryker-mutator/jest-runner",
  mocha: "@stryker-mutator/mocha-runner",
  jasmine: "@stryker-mutator/jasmine-runner",
  tap: "@stryker-mutator/tap-runner",
  command: null,
  unknown: null,
};

/**
 * Stryker supports Jest, Vitest, Mocha, Jasmine, and Tap plugins — not the
 * ava/uvu-style frameworks a lot of newer packages use. Rather than reporting
 * those projects as unsupported, we fall back to Stryker's built-in
 * **command runner**, which needs no plugin: it just runs the project's own
 * `npm test` and reads the exit code per mutant. Slower (no per-test
 * coverage), but it works with any framework, so "unsupported project"
 * becomes "supported, slower" instead of a dead end.
 *
 * `runner: "unknown"` is now reserved for the case where we couldn't even
 * read package.json — i.e. this isn't a Node project at all.
 */
export async function detectTestRunner(cwd: string): Promise<DetectedRunner> {
  const pkgPath = path.join(cwd, "package.json");

  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
  } catch {
    return { runner: "unknown", strykerPlugin: null };
  }

  const allDeps = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);

  for (const { runner, packages } of DETECTION_ORDER) {
    if (packages.some((name) => allDeps.has(name))) {
      return { runner, strykerPlugin: PLUGIN_BY_RUNNER[runner] };
    }
  }

  return { runner: "command", strykerPlugin: null };
}
