import { describe, it, expect } from "vitest";
import { diagnoseStrykerFailure } from "./stryker-runner.js";

/**
 * Every fixture below is verbatim output from a failure that actually
 * occurred while getting this integration working. Paraphrasing them would
 * defeat the point: these patterns have to match what Stryker really emits,
 * not what we remember it emitting.
 */
describe("diagnoseStrykerFailure", () => {
  it("identifies a missing test-runner plugin", () => {
    const output =
      'StrykerError: Error: Could not inject [class ChildProcessTestRunnerWorker]. ' +
      'Cause: Cannot find TestRunner plugin "vitest". In fact, no TestRunner ' +
      "plugins were loaded. Did you forget to install it?";

    const result = diagnoseStrykerFailure(output, "vitest");

    expect(result).not.toBeNull();
    expect(result?.message).toContain("vitest");
    expect(result?.message).toContain("plugin");
    // The install command has to name the right package, or the hint is noise.
    expect(result?.hint).toContain("@stryker-mutator/vitest-runner");
  });

  it("names the runner's own plugin package, not a hardcoded one", () => {
    const output = 'Cannot find TestRunner plugin "mocha".';
    const result = diagnoseStrykerFailure(output, "mocha");
    expect(result?.hint).toContain("@stryker-mutator/mocha-runner");
    expect(result?.hint).not.toContain("vitest");
  });

  it("mentions the peer dependency check for a missing plugin", () => {
    // On is-number the plugin WAS installed; the real cause was mocha@3.5.3
    // against a plugin requiring >=7.2. Without this hint the message sends
    // people to reinstall a package they already have.
    const output = "no TestRunner plugins were loaded";
    const result = diagnoseStrykerFailure(output, "mocha");
    expect(result?.hint).toMatch(/peer dependency/i);
  });

  it("identifies a tsconfig that cannot be resolved inside the sandbox", () => {
    const output =
      "[TSCONFIG_ERROR] Failed to load tsconfig for " +
      "'.test-guard/.stryker-tmp/sandbox-VTAWAD/src/mutation/stryker-config.test.ts': " +
      "Tsconfig not found";

    const result = diagnoseStrykerFailure(output, "vitest");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/tsconfig/i);
    // The fix is non-obvious, so the hint must explain the sandbox copy.
    expect(result?.hint).toMatch(/sandbox|extends/i);
  });

  it("identifies a failing baseline test suite", () => {
    const output =
      "ERROR Stryker There were failed tests in the initial test run.\n" +
      "ConfigError: There were failed tests in the initial test run.";

    const result = diagnoseStrykerFailure(output, "vitest");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/does not pass|failed/i);
  });

  it("identifies a suite that executed no tests", () => {
    const output =
      "ERROR Stryker No tests were executed. Stryker will exit prematurely. " +
      "Please check your configuration.";

    const result = diagnoseStrykerFailure(output, "vitest");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/no tests/i);
  });

  it("identifies mutate globs that matched nothing", () => {
    const output =
      'WARN ProjectReader Glob pattern ' +
      '"packages/cli/src/mutation/stryker-config.ts:18-18" did not result in any files.';

    const result = diagnoseStrykerFailure(output, "vitest");

    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/no files to mutate/i);
    // This is the monorepo/subdirectory case, so say so.
    expect(result?.hint).toMatch(/subdirector|repo root/i);
  });

  it("identifies an unresolved module and names it", () => {
    const output = "Error: Cannot find module 'some-missing-pkg'";
    const result = diagnoseStrykerFailure(output, "vitest");
    expect(result).not.toBeNull();
    expect(result?.message).toContain("some-missing-pkg");
  });

  it("identifies running out of disk space", () => {
    const output = "Error: ENOSPC: no space left on device, write";
    const result = diagnoseStrykerFailure(output, "vitest");
    expect(result).not.toBeNull();
    expect(result?.message).toMatch(/disk space/i);
  });

  it("returns null for output it does not recognise", () => {
    // Guarding against over-matching: a wrong diagnosis is worse than none,
    // because the caller falls back to printing the raw output.
    const result = diagnoseStrykerFailure("some unrelated crash", "vitest");
    expect(result).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(diagnoseStrykerFailure("", "vitest")).toBeNull();
  });

  it("always supplies both a message and a hint when it matches", () => {
    const outputs = [
      "Cannot find TestRunner plugin",
      "Tsconfig not found",
      "There were failed tests in the initial test run",
      "No tests were executed",
      "did not result in any files",
      "ENOSPC",
      "Cannot find module 'x'",
    ];
    for (const output of outputs) {
      const result = diagnoseStrykerFailure(output, "vitest");
      expect(result?.message, output).toBeTruthy();
      expect(result?.hint, output).toBeTruthy();
    }
  });
});
