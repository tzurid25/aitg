# Publishing the CLI

## Workspace dependencies must never reach npm

`@aitg/shared` is a **devDependency**, not a dependency, even though the CLI's
source imports from it. That is deliberate and load-bearing.

tsup bundles `@aitg/shared` into `dist/index.js` at build time (`noExternal`
in `tsup.config.ts`). The built artifact has no reference to it. But if it
were listed under `dependencies`, the published `package.json` would carry:

```json
"@aitg/shared": "workspace:*"
```

`workspace:*` is a pnpm protocol that only resolves inside this monorepo. Every
`npm install -g @aitg/cli` would fail with `Unsupported URL Type "workspace:"`
— and it would fail for users, not for us, because it works fine locally.

**Rule:** anything bundled by tsup belongs in `devDependencies`. Only packages
resolved at runtime from the user's `node_modules` belong in `dependencies`.

`@stryker-mutator/core` is the counter-example: it stays external, is resolved
from the *user's* project at runtime, and is deliberately in neither list —
the user installs it themselves.

## Pre-publish check

```bash
pnpm --filter @aitg/cli build
cd packages/cli && npm pack --dry-run
```

Inspect the output. If any `workspace:` string appears in the packed
`package.json`, stop.

Verify the bundle is self-contained:

```bash
cd /tmp && mkdir cli-test && cd cli-test && npm init -y
npm install /path/to/aitg/packages/cli
node node_modules/@aitg/cli/dist/index.js --version
```

This must work in a directory with no access to the monorepo. It is the only
check that actually reproduces what a user experiences.
