# aitg

[![npm](https://img.shields.io/npm/v/@aitg/cli)](https://www.npmjs.com/package/@aitg/cli)
[![license](https://img.shields.io/npm/l/@aitg/cli)](LICENSE)
[![tests](https://img.shields.io/badge/tests-54%20passing-brightgreen)](packages/cli/src)
[![node](https://img.shields.io/badge/node-%3E%3D18-blue)](https://nodejs.org)

**Find the tests that pass without checking anything.**

---

This function has 100% test coverage:

```js
function classify(score) {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}
```

This is the suite that covers it:

```js
test("high score",  () => expect(classify(95)).toBeDefined());
test("mid score",   () => expect(classify(60)).toBeDefined());
test("low score",   () => expect(classify(10)).toBeDefined());
```

Flip `>=` to `>`. Flip it to `<`. Replace either condition with `true`.
Delete a branch. **The suite still passes — every time.**

```
$ npx aitg scan

  Mutation score: 0%          <-- 8 ways to break this code
  Coverage:       100%        <-- 0 of them caught
```

Coverage answers *"did a test run this line?"*
The question that matters is *"would a test fail if this line were wrong?"*

The gap between those two questions is where bugs reach production.

## How it works

`aitg` changes your source on purpose — `>=` becomes `>`, a condition becomes
`true`, a boolean is negated — and re-runs your tests against each change.

- A test fails → that behaviour is genuinely verified.
- Nothing fails → the line runs, but nothing asserts on it. That's a gap.

This is mutation testing, and it isn't new. What keeps it off most projects is
cost: mutating a whole repo means running your suite thousands of times.

**`aitg` mutates only the lines in your `git diff`.** Minutes become seconds,
so it fits in a pull request instead of a nightly job.

## Quick start

```bash
npm install --save-dev @aitg/cli @stryker-mutator/core
npx aitg init --local    # no account, nothing uploaded
npx aitg scan
```

Add the Stryker plugin for your runner (`@stryker-mutator/vitest-runner`,
`jest-runner`, `mocha-runner`, …). Using ava, uvu, or `node:test`? No plugin
needed — it falls back to Stryker's command runner automatically.

## What you get

`.test-guard/fix-prompt.md`, ready to paste into any coding assistant. Each
gap explained in terms of the test you need to write:

```diff
- if (score >= 80) return "healthy";
+ score > 80
```
> A comparison boundary was shifted (inclusive ↔ exclusive) and no test
> noticed, so the exact edge value is untested. Assert the boundary itself,
> not just values on either side.

```diff
- if (score >= 80) return "healthy";
+ score < 80
```
> A comparison was reversed and no test noticed, so the direction of the
> check is unverified.

Same line, different tests required. `>= → >` is only distinguishable at
exactly `80`; `>= → <` is distinguishable almost anywhere. The explanation is
derived from the actual mutation rather than its category, because sending
someone to write the wrong test is worse than saying nothing.

Uncovered code gets its own section — if nothing reaches a line, no mutant
there can survive, so a file with *zero* tests would otherwise look cleaner
than one with weak tests.

## Isn't this just Stryker?

`aitg` runs on [StrykerJS](https://stryker-mutator.io/). Stryker does the
mutation work; this is the layer that makes it usable per-PR:

| | Stryker alone | with `aitg` |
| --- | --- | --- |
| Scope | Whole project (or hand-configured globs) | Exactly the lines in your diff |
| Setup | Config file, plugin wiring, tuning | `aitg init --local` |
| Runtime | Minutes to hours | Seconds |
| Output | Mutant list / HTML report | Ranked gaps + a prompt to fix them |
| Unsupported runner | Manual command-runner config | Automatic fallback |

If you already run Stryker across your repo on a schedule, keep doing that.
This is for the pull request you're reviewing right now.

## CI

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }     # merge-base needs history
- run: npm ci
- run: npx aitg scan --base origin/main
```

Exits non-zero when the gate fails. Threshold and exclusions live in
`aitg.config.json`.

## Commands

| Command | |
| --- | --- |
| `aitg init --local` | Set up. No account, nothing uploaded. |
| `aitg scan` | Mutation-test the changed lines. |
| `aitg scan --dry-run` | Show the mutation surface without running it. |
| `aitg scan --base <ref>` | Diff against a specific ref. |
| `aitg report` | Re-print the last report. |
| `aitg doctor` | Diagnose the local setup. |

Full usage: [`packages/cli/README.md`](packages/cli/README.md).

## On testing this tool

54 tests, validated by mutation rather than by coverage: six defects fixed
during development were deliberately reintroduced, and each had to make tests
fail.

One didn't. A test asserting that the diff engine compares against the
merge-base rather than the branch tip passed under *both* strategies — the
fixture's divergent commit added a file, which reads as a deletion against the
tip, and deletions are skipped anyway. It looked correct, it passed, and it
verified nothing.

That is the exact failure mode this tool exists to find, discovered in its own
suite. It's documented in [KNOWN-ISSUES.md](KNOWN-ISSUES.md) alongside every
other defect found while building it.

## Limits

- Needs a **passing** suite to start from — mutation runs are compared against
  a green baseline.
- Slower than coverage. Scoped to a diff it's seconds, but it isn't free.
- Measures one property: whether your assertions would notice a change. It
  won't tell you you're testing the wrong things entirely.

## Repository

| Path | |
| --- | --- |
| `packages/cli` | The `aitg` command. This is the published package. |
| `packages/shared` | Report generation and triage. |
| `apps/web`, `apps/api` | Optional dashboard: history and score over time. |

The CLI is fully offline. The dashboard is optional.

```bash
pnpm install
pnpm --filter @aitg/cli build
pnpm --filter @aitg/cli exec vitest run src/
```

MIT
