import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  // Stryker is resolved from the *user's* project at runtime, not bundled
  // into the CLI. Bundling it would balloon the package and break its own
  // plugin resolution.
  external: ["@stryker-mutator/core"],
  // Workspace packages are bundled in, not left as runtime imports.
  //
  // This is load-bearing. The dashboard's webpack build requires relative
  // imports WITHOUT a .js extension (it cannot map "./x.js" onto "x.ts"),
  // while Node's ESM loader requires the extension to be present. The same
  // source files feed both. Bundling @aitg/shared into the CLI resolves the
  // conflict at build time: Node never sees those specifiers at all.
  //
  // It is also correct on its own terms — a globally installed CLI should
  // not carry unpublished workspace dependencies.
  noExternal: ["@aitg/shared"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
