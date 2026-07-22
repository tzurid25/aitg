import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectTestRunner } from "./detect-runner.js";

/**
 * These run against a real temp directory rather than a mocked fs. The
 * function's whole job is reading a package.json off disk, so mocking the
 * read would test the mock.
 */
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "aitg-detect-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function writePkg(pkg: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
}

describe("detectTestRunner", () => {
  it("detects vitest from devDependencies", async () => {
    await writePkg({ devDependencies: { vitest: "^1.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("vitest");
    expect(result.strykerPlugin).toBe("@stryker-mutator/vitest-runner");
  });

  it("detects a runner from dependencies, not just devDependencies", async () => {
    await writePkg({ dependencies: { mocha: "^10.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("mocha");
    expect(result.strykerPlugin).toBe("@stryker-mutator/mocha-runner");
  });

  it("prefers vitest over jest when both are present", async () => {
    // A project mid-migration keeps jest installed alongside vitest. Picking
    // jest there would run the wrong suite entirely.
    await writePkg({ devDependencies: { jest: "^29.0.0", vitest: "^1.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("vitest");
  });

  it("detects jest via ts-jest without a direct jest dependency", async () => {
    await writePkg({ devDependencies: { "ts-jest": "^29.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("jest");
  });

  it("detects jasmine via jasmine-core", async () => {
    await writePkg({ devDependencies: { "jasmine-core": "^5.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("jasmine");
  });

  it("detects tap", async () => {
    await writePkg({ devDependencies: { tap: "^18.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("tap");
    expect(result.strykerPlugin).toBe("@stryker-mutator/tap-runner");
  });

  // --- The command-runner fallback -------------------------------------
  //
  // Stryker ships plugins for five runners. Everything else used to be
  // reported as an unsupported project. These assert the fallback that turns
  // "unsupported" into "supported, slower".

  it("falls back to the command runner for ava", async () => {
    await writePkg({ devDependencies: { ava: "^6.0.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("command");
    expect(result.strykerPlugin).toBeNull();
  });

  it("falls back to the command runner for uvu", async () => {
    await writePkg({ devDependencies: { uvu: "^0.5.0" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("command");
    expect(result.strykerPlugin).toBeNull();
  });

  it("falls back to the command runner for node:test (no test dependency at all)", async () => {
    await writePkg({ name: "uses-node-test", scripts: { test: "node --test" } });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("command");
  });

  it("falls back to the command runner when there are no dependencies", async () => {
    await writePkg({ name: "bare" });
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("command");
  });

  // --- "unknown" means not a Node project ------------------------------

  it("reports unknown when package.json is missing", async () => {
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("unknown");
    expect(result.strykerPlugin).toBeNull();
  });

  it("reports unknown when package.json is malformed", async () => {
    await fs.writeFile(path.join(dir, "package.json"), "{ not json", "utf-8");
    const result = await detectTestRunner(dir);
    expect(result.runner).toBe("unknown");
  });
});
