# Known issues

Everything below was reproduced on a real machine (Windows 11, Node 24, pnpm
workspace) and verified fixed by an end-to-end `aitg scan`. Where a claim was
not verified by a run, it says so.

---

## RESOLVED -- Stryker integration

The original blocker ("programmatic Stryker cannot load runner plugins") was
real, and the prescribed fix -- spawn Stryker instead of importing it -- was
correct. But it was **not sufficient on its own**. Seven further defects sat
behind it, each surfacing only once the previous one was fixed. They are
documented individually because several are not Stryker's fault and would
recur in any similar integration.

### 1. Programmatic import breaks plugin resolution

**Cause.** Stryker spawns a child process to host the test runner, and that
child resolves plugins through its own module context. Loading core by
absolute file path -- necessary to load it from the *user's* project rather
than the CLI's -- leaves the child without a context that can find sibling
plugins.

**Fix.** `spawn('npx stryker run <configPath>', { cwd: userProjectRoot })`,
then read results from the JSON report on disk. Removed `loadStryker` and the
exports-map parsing entirely.

The original doc was right that vitest scans passing on two projects was
coincidence rather than correctness.

### 2. `spawn EINVAL` on Windows

**Cause.** `npx` resolves to `npx.cmd` on Windows, and Windows cannot exec
`.cmd`/`.bat` directly through `spawn` -- it needs a shell. Without one,
spawn throws before the process starts.

**Fix.** `shell: true` on Windows only.

### 3. Node deprecation warning DEP0190

**Cause.** Passing an args array together with `shell: true` makes Node
concatenate them unescaped; Node warns about this.

**Fix.** On Windows, build and quote a single command string instead of
handing spawn an args array.

### 4. Plugin discovery still fails under pnpm

**This is the defect the original doc missed, and it invalidates its central
claim** that spawning makes "plugin discovery Stryker's problem again, not
ours."

**Cause.** pnpm's isolated `node_modules` layout means Stryker's default
plugin discovery -- a glob over `@stryker-mutator/*` relative to where core
resolves from -- cannot see sibling plugin packages that are not core's own
dependencies. This reproduces **with Stryker running as a clean subprocess
from the project root**, so it is a separate defect from #1, not a symptom
of it.

**Fix.** Resolve the plugin's absolute entry file from the user's project
(`resolveRunnerPlugin`) and pass it in `plugins`. An absolute path bypasses
module resolution rather than depending on it. Deliberately scoped to the
*plugin* only -- core is still loaded as a subprocess.

### 5. Diff pathspec resolves against cwd, not repo root

**Cause.** `git diff --name-status` reports paths relative to the repo root,
but a pathspec is resolved relative to the git process's cwd. Running from a
package subdirectory made git look for `packages/cli/packages/cli/src/...`,
match nothing, and drop the file **silently** -- no error, and no entry in
`excludedPaths`.

**Symptom.** "No mutable production code changed - nothing to scan" on a
branch with real changes.

**Fix.** Prefix the pathspec with git's root-relative magic: `:/${path}`.

### 6. Mutate patterns need cwd-relative paths

**Cause.** Same root convention, opposite direction. Stryker runs with `cwd`
as its project root, so its `mutate` globs must be relative to `cwd` -- but
they were being handed repo-root-relative paths.

**Symptom.** `Glob pattern "..." did not result in any files`, then
`No tests were executed`.

**Fix.** Re-anchor in `scan.ts` via `path.relative(cwd, ...)`. `DiffResult`
gained a `repoRoot` field so the diff engine keeps its own convention intact.

### 7. tsconfig `extends` outside the package breaks in the sandbox

**Not an AITG bug -- a monorepo constraint worth documenting.**

**Cause.** Stryker copies the package into a temporary sandbox. A tsconfig
that extends a file outside the package (`"../../tsconfig.base.json"`) is not
copied with it, so the test runner cannot resolve its config.

**Fix (project-side).** Inline the base settings into the package's own
`tsconfig.json`.

### 8. Nested sandboxes accumulate across failed runs

**Cause.** `cleanTempDir` only fires on a clean exit. A crashed run leaves its
sandbox behind; the next run's sandbox copy takes everything under the project
directory -- including the orphan -- so each failure nests one level deeper.
Deep enough, relative-path lookups inside the sandbox break.

**Symptom.** Paths like
`.test-guard/.stryker-tmp/sandbox-A/.test-guard/.stryker-tmp/sandbox-B/...`,
eventually exceeding Windows' path limit (`Remove-Item` itself fails; use
`-LiteralPath "\\?\C:\..."`).

**Fix.** Delete `.test-guard/.stryker-tmp` before every run, regardless of how
the previous one ended.

---

## RESOLVED -- report accuracy

### 9. Mutation explanations did not match the mutation

**Cause.** `describeMutator` chose its text from the mutator *name* alone,
ignoring what actually changed. So `>=` -> `>` (a boundary shift, distinguished
only by the exact edge value) and `>=` -> `<` (a full inversion, distinguished
by almost any input) both rendered as "an equality check was inverted".

**Why it mattered.** The wrong text sends the developer to write the wrong
test, and it visibly contradicts the diff printed directly above it -- which
costs trust in every other line of the report.

**Fix.** Compare the mutated operator against the original. Also distinguishes
`ConditionalExpression` -> `true`/`false` (a dropped branch) from an altered
boundary. Verified against 8 real operator pairs.

### 10. Uncovered code was reported as "No action needed"

**Cause.** The fix prompt only ever received *survivors*. Mutants skipped for
lack of any covering test never survive -- they never run -- so a file with
zero tests produced `# No action needed`.

**Why it mattered.** The tool issued a clean bill of health over completely
untested code. A file with weak tests looked worse than a file with none.

**Fix.** Thread `NO_COVERAGE` mutants through to the prompt as their own
section, aggregated per file, with the distinction spelled out: a survivor
means tighten an assertion; no-coverage means write a test that reaches the
code at all. When there are no survivors but uncovered code exists, the prompt
is titled "Task: add tests for uncovered code".

### 11. Non-ASCII characters mangled in generated reports

**Cause.** Reports are written UTF-8 without a BOM. Windows tooling reads them
in the legacy code page, so an em dash renders as `ג€"`.

**Fix.** ASCII equivalents (`--`, `-`, `...`) in all report-generating code.
Chosen over adding a BOM, which breaks other tooling. Terminal-only symbols
are left alone -- they render correctly.

### 12. Dashboard dates rendered in the browser's locale

**Cause.** Eight `toLocaleDateString()` calls with no locale argument (or
`undefined`), which falls back to the browser's language. On a Hebrew-locale
browser the English dashboard showed Hebrew dates.

**Fix.** Pinned to `"en-US"`. `<html lang="en">` was already correct.

---

## RESOLVED -- adoption friction

### 13. `aitg init` required a cloud account

`scan` already worked offline, but `init` did not -- so the only documented
path to a first scan went through a signup form, before the developer had seen
any value. During development this was worked around by hand-writing
`aitg.config.json`, which is not something to ask of a user.

**Fix.** `aitg init --local` writes a local-only config with real defaults
(70% threshold), no credentials and no network. `aitg init` without
credentials now names `--local` as the first option rather than only
`aitg login`.

### 14. Failures reported only an exit code

Every failure above first appeared as
`Mutation testing failed (stryker exited with code 1)`. Diagnosing each one
required re-running with `AITG_DEBUG=1` and reading a stack trace.

**Fix.** `diagnoseStrykerFailure` recognises seven failure classes -- missing
plugin (with the peer-dependency hint that was the actual root cause on one
project), sandbox tsconfig, red baseline suite, no tests executed, empty
mutate glob, disk space, unresolved module -- and reports cause plus fix
directly. Unrecognised failures now print the last 25 lines of Stryker's
output rather than only an exit code. Verified by forcing a missing-plugin
failure.

---

## Verified working

Mutation detection itself was confirmed end-to-end against a deliberately weak
test suite (`expect(fn(x)).toBeDefined()` over a three-branch classifier):
67 mutants, 8 survivors, landing exactly on the two threshold comparisons. A
coverage tool would have reported 100% on the same suite.

---

## Open

Nothing outstanding. All previously-open items are closed.

**`command` runner fallback** -- verified end-to-end against a real project
using `node:test` (a framework with no Stryker plugin). Produced 12 mutants
and correctly surfaced 8 survivors on the two threshold comparisons, with
`coverageAnalysis: "off"` and no `plugins` field, as intended.

**Test suite** -- 54 tests across `detect-runner`, `stryker-config`, the
failure diagnoser, and the diff engine.

The diff-engine tests build a real git repository per test rather than mocking
simple-git. That is deliberate: bugs #5 and #6 were both about how git resolves
pathspecs relative to a process's cwd, and a mocked git would have returned
whatever paths it was told to. Only real git reproduces them.

The suite was validated by mutation rather than by coverage. Six past defects
were deliberately reintroduced; each was caught:

| Reintroduced defect | Tests that failed |
| --- | ---: |
| `perTest` coverage on the command runner | 2 |
| ava/uvu falling back to `unknown` | 4 |
| jest ordered before vitest | 1 |
| diagnoser always returning null | 10 |
| pathspec without `:/` (bug #5) | 3 |
| `repoRoot` not read from git (bug #6) | 1 |

One test initially failed this check. The merge-base test used an *added* file
for the divergent commit, which appears as a deletion when diffing against the
branch tip -- and deletions are skipped, so both strategies produced the same
visible result and the assertion passed either way. It now modifies a shared
file instead, and catches the mutation. Worth recording: the test looked
correct, passed, and verified nothing. That is the exact failure mode this tool
exists to detect, found in its own suite.

Remaining, though neither is a defect:

- `scan.ts` orchestration is covered only indirectly, through the units it
  calls. End-to-end coverage there needs a fixture project plus a Stryker run.
- The diagnoser matches seven known failure classes. New Stryker versions may
  introduce others; unrecognised output falls back to printing Stryker's last
  25 lines, which degrades gracefully.
