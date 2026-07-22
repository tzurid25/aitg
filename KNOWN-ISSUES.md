# Known issues

## BLOCKER — programmatic Stryker cannot load runner plugins

**Status: root cause identified. The fix is an architectural change, not a
patch. Do not publish until it is done.**

### The finding

Stryker fails to load its test-runner plugin **even when invoked directly,
with no AITG code in the path**, using either supported plugin format:

```
absolute file path : fails — Cannot find TestRunner plugin "mocha"
package name       : fails — Cannot find TestRunner plugin "mocha"
```

Both entry files resolve and exist on disk. Versions match (9.6.1 ↔ 9.6.1).
mocha is installed. **This is not our bug.**

### Root cause

Stryker spawns a **child process** to host the test runner. That child
resolves plugins through its own module context. When Stryker core is loaded
by importing an absolute file path — which is what our `loadStryker` does, and
what it must do to load core from the *user's* project rather than the CLI's —
the child process does not inherit a resolution context that can find sibling
plugins.

Stryker is designed to be invoked as `npx stryker run` from the project root.
Importing it programmatically from an arbitrary location is outside what it
supports.

### Why the earlier "fixes" appeared to work

Vitest scans succeeded on two projects. Those installs happened to place
everything where the child process could find it. `--legacy-peer-deps`,
pnpm's symlinked store, and monorepo hoisting all break that coincidence —
so the passing runs were luck, not correctness.

### The correct fix

**Stop importing Stryker. Spawn it.**

```
spawn('npx', ['stryker', 'run', configPath], { cwd: userProjectRoot })
```

Then read `reports/mutation/mutation.json` for results.

| | Programmatic import | Subprocess |
| --- | --- | --- |
| Plugin resolution | broken outside ideal layouts | Stryker's own, always correct |
| Failure mode | cryptic injection error | Stryker's own diagnostics |
| Results | in-memory | read from the JSON report |
| Supported by Stryker | no | yes, this is the intended path |

This also removes `loadStryker`, `resolveRunnerPlugin`, and the exports-map
parsing entirely — all of which exist only to work around a usage Stryker
never supported.

### Second change to make at the same time: universal runner support

Stryker supports Jest, Vitest, Mocha, Jasmine, Cucumber, Tap — **not ava or
uvu**, which four of five surveyed open-source packages use.

Stryker's built-in **command runner** needs no plugin at all: it runs the
project's own test command and reads the exit code. Slower (no per-test
coverage, so every mutant runs the full suite) but it works with **any**
framework.

Falling back to `testRunner: "command"` when no supported plugin is detected
turns "unsupported project" into "supported, slower" — and the subprocess
change makes it trivial, since the command runner is part of core.

`aitg doctor` should also state the detected runner and whether it will use a
plugin or the command fallback, so the user learns this before a scan rather
than during one.

### Reproduction

```bash
git clone --depth 20 https://github.com/jonschlinkert/is-number.git
cd is-number && npm install
npm install -D --legacy-peer-deps @stryker-mutator/core @stryker-mutator/mocha-runner
npm install --legacy-peer-deps <aitg tarball>
git checkout -b t && <edit index.js> && git commit -am x
node node_modules/@aitg/cli/dist/index.js scan
```

---

## Verified working (do not regress)

- Packed tarball installs cleanly in a fresh project; no `workspace:` refs
- Diff engine: correct mutation surface on real git history
- Quality gate exit code 1 for CI
- `report.md` and `fix-prompt.md` generation
- Local scan with no account
- Triage: 92 survivors → 23 gaps, permission inversions ranked CRITICAL
- Dashboard, auth, P0 severity, replay panel

## Fixed during real-world testing

- **Duplicate line numbers** — `2 places — lines 13, 13`. Stryker emits the
  same mutation at multiple columns on one line; lines are now deduplicated.
- **`doctor` false green** — reported "API reachable" without making any
  network request when signed out. Now calls `/api/health` with a 5s timeout.
