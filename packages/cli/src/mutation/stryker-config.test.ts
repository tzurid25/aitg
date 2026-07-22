import { describe, it, expect } from "vitest";
import { buildMutatePatterns } from "./stryker-config.js";

describe("buildMutatePatterns", () => {
  it("formats a single target with a single range", () => {
    const result = buildMutatePatterns([
      { path: "src/calc.ts", ranges: [{ start: 12, end: 18 }] },
    ]);
    expect(result).toEqual(["src/calc.ts:12-18"]);
  });

  it("formats multiple ranges on the same file", () => {
    const result = buildMutatePatterns([
      {
        path: "src/calc.ts",
        ranges: [
          { start: 1, end: 5 },
          { start: 10, end: 12 },
        ],
      },
    ]);
    expect(result).toEqual(["src/calc.ts:1-5", "src/calc.ts:10-12"]);
  });

  it("returns an empty array for no targets", () => {
    expect(buildMutatePatterns([])).toEqual([]);
  });
});