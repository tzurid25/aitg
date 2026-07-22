import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Stryker copies this package into .test-guard/.stryker-tmp while it
    // runs. Without this exclude, a sandbox left behind by an interrupted
    // run gets picked up as a real test directory on the next `vitest run`,
    // producing duplicate results.
    exclude: ["**/node_modules/**", "**/dist/**", ".test-guard/**"],
  },
});
