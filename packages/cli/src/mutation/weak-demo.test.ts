import { describe, it, expect } from "vitest";
import { classifyScore } from "./weak-demo.js";

describe("classifyScore", () => {
  it("returns a value for a high score", () => {
    expect(classifyScore(95)).toBeDefined();
  });

  it("returns a value for a mid score", () => {
    expect(classifyScore(60)).toBeDefined();
  });

  it("returns a value for a low score", () => {
    expect(classifyScore(10)).toBeDefined();
  });
});