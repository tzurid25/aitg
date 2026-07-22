import { describe, it, expect } from "vitest";
import {
  buildStrykerConfig,
  buildMutatePatterns,
  HIGH_SIGNAL_MUTATORS,
  OUTPUT_DIR,
} from "./stryker-config.js";
import type { ScanTarget } from "./types.js";

const target = (path: string, ranges: Array<[number, number]>): ScanTarget => ({
  path,
  ranges: ranges.map(([start, end]) => ({ start, end })),
});

describe("buildMutatePatterns", () => {
  it("formats a single range as file:start-end", () => {
    expect(buildMutatePatterns([target("src/calc.ts", [[12, 18]])])).toEqual([
      "src/calc.ts:12-18",
    ]);
  });

  it("emits one pattern per range on the same file", () => {
    expect(
      buildMutatePatterns([target("src/calc.ts", [[1, 5], [10, 12]])]),
    ).toEqual(["src/calc.ts:1-5", "src/calc.ts:10-12"]);
  });

  it("handles multiple files", () => {
    expect(
      buildMutatePatterns([
        target("src/a.ts", [[1, 1]]),
        target("src/b.ts", [[7, 9]]),
      ]),
    ).toEqual(["src/a.ts:1-1", "src/b.ts:7-9"]);
  });

  it("returns an empty array for no targets", () => {
    expect(buildMutatePatterns([])).toEqual([]);
  });
});

describe("buildStrykerConfig", () => {
  const base = { targets: [target("src/a.ts", [[1, 5]])], cwd: "/repo" };

  it("uses perTest coverage for a plugin-backed runner", () => {
    // Cost lever: only run tests that cover each mutant.
    const config = buildStrykerConfig({ ...base, testRunner: "vitest" });
    expect(config.testRunner).toBe("vitest");
    expect(config.coverageAnalysis).toBe("perTest");
  });

  it("disables coverage analysis for the command runner", () => {
    // The command runner re-runs the whole suite per mutant and cannot report
    // per-test coverage. Asking for perTest makes Stryker error at startup.
    const config = buildStrykerConfig({ ...base, testRunner: "command" });
    expect(config.testRunner).toBe("command");
    expect(config.coverageAnalysis).toBe("off");
  });

  it("maps an unknown runner onto the command runner", () => {
    const config = buildStrykerConfig({ ...base, testRunner: "unknown" });
    expect(config.testRunner).toBe("command");
    expect(config.coverageAnalysis).toBe("off");
  });

  it("omits plugins entirely when no plugin paths are supplied", () => {
    // An empty array here would make Stryker load no plugins at all, rather
    // than falling back to its own discovery.
    const config = buildStrykerConfig({ ...base, testRunner: "command" });
    expect(config.plugins).toBeUndefined();
  });

  it("passes explicit plugin paths through", () => {
    const config = buildStrykerConfig({
      ...base,
      testRunner: "vitest",
      pluginPaths: ["/abs/path/to/vitest-runner/index.js"],
    });
    expect(config.plugins).toEqual(["/abs/path/to/vitest-runner/index.js"]);
  });

  it("excludes every mutator outside the high-signal set", () => {
    const config = buildStrykerConfig({
      ...base,
      testRunner: "vitest",
      highSignalOnly: true,
    });
    const excluded = config.mutator?.excludedMutations ?? [];
    for (const mutator of HIGH_SIGNAL_MUTATORS) {
      expect(excluded).not.toContain(mutator);
    }
    expect(excluded).toContain("StringLiteral");
    expect(excluded.length).toBeGreaterThan(0);
  });

  it("applies no mutator exclusions unless high-signal mode is requested", () => {
    const config = buildStrykerConfig({ ...base, testRunner: "vitest" });
    expect(config.mutator).toBeUndefined();
  });

  it("honours explicit concurrency and timeout", () => {
    const config = buildStrykerConfig({
      ...base,
      testRunner: "vitest",
      concurrency: 3,
      timeoutMs: 5000,
    });
    expect(config.concurrency).toBe(3);
    expect(config.timeoutMS).toBe(5000);
  });

  it("leaves at least one core free by default", () => {
    const config = buildStrykerConfig({ ...base, testRunner: "vitest" });
    expect(config.concurrency).toBeGreaterThanOrEqual(1);
  });

  it("writes all artefacts under the output directory", () => {
    const config = buildStrykerConfig({ ...base, testRunner: "vitest" });
    expect(config.incrementalFile).toContain(OUTPUT_DIR);
    expect(config.jsonReporter.fileName).toContain(OUTPUT_DIR);
    expect(config.tempDirName).toContain(OUTPUT_DIR);
  });

  it("defaults to incremental runs", () => {
    expect(buildStrykerConfig({ ...base, testRunner: "vitest" }).incremental).toBe(true);
  });

  it("allows incremental to be turned off", () => {
    const config = buildStrykerConfig({
      ...base,
      testRunner: "vitest",
      incremental: false,
    });
    expect(config.incremental).toBe(false);
  });

  it("disables type checks so mutations are not reported as compile errors", () => {
    expect(buildStrykerConfig({ ...base, testRunner: "vitest" }).disableTypeChecks).toBe(
      true,
    );
  });
});
