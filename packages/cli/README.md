# aitg

**Coverage is not quality. Mutation score is.**

AI writes tests that execute your code without ever checking what it does.
They pass. Coverage hits 100%. Then a bug ships through a line every report
said was tested.

`aitg` finds those tests. It makes small, deliberate changes to your changed
code -- flipping a `>=` to `>`, replacing a condition with `true` -- and
re-runs your suite. If nothing fails, that behaviour is executed but never
verified, and `aitg` tells you exactly where and what to assert.

It scans only the lines in your diff, so it runs in seconds rather than
mutating the whole repository.

## Install

```bash
npm install --save-dev @aitg/cli @stryker-mutator/core
```

Plus the Stryker plugin for your test runner:

```bash
# pick the one you use
npm install --save-dev @stryker-mutator/vitest-runner
npm install --save-dev @stryker-mutator/jest-runner
npm install --save-dev @stryker-mutator/mocha-runner
```

Using ava, uvu, `node:test`, or anything else? No plugin needed -- `aitg`
falls back to Stryker's command runner automatically. Slower, but it works.

## Use

```bash
npx aitg init --local   # no account required
npx aitg scan
```

That's it. `scan` diffs against your default branch, mutates only the changed
lines, and writes two files:

- `.test-guard/report.md` -- what happened, ranked by severity
- `.test-guard/fix-prompt.md` -- a prompt you can paste into Claude, Cursor,
  or Copilot to get the missing tests written

## What you get

```
Mutation testing complete (vitest, 67 mutants).

Results
  Mutation score: 0%
  Killed:       0
  Survived:     8
  No coverage:  29

Surviving mutants
  ! src/classify.ts:2 (EqualityOperator)
  ! src/classify.ts:3 (ConditionalExpression)
```

And in `fix-prompt.md`, for each gap:

```diff
- if (score >= 80) return "healthy";
+ score > 80
```

> A comparison boundary was shifted (inclusive <-> exclusive) and no test
> noticed, so the exact edge value is untested. Assert the boundary itself,
> not just values on either side.

The explanation is derived from the actual mutation, not its category -- a
boundary shift and a reversed comparison need different tests, and you are
told which one you are looking at.

## Commands

| Command | What it does |
| --- | --- |
| `aitg init --local` | Set up in this repo. No account, nothing uploaded. |
| `aitg init` | Set up and link to the cloud dashboard. |
| `aitg scan` | Mutation-test the changed lines. |
| `aitg scan --dry-run` | Show the mutation surface without running anything. |
| `aitg scan --base <ref>` | Diff against a specific branch or ref. |
| `aitg scan --uncommitted` | Include working-tree changes. |
| `aitg report` | Re-print the last local report. |
| `aitg doctor` | Diagnose the local setup. |

## Configuration

`aitg init` writes `aitg.config.json`:

```json
{
  "minMutationScore": 70,
  "maxSurvivedMutants": null,
  "failBuildOnBreach": true,
  "excludePatterns": ["**/*.test.*", "**/node_modules/**", "**/dist/**"]
}
```

`scan` exits non-zero when the gate fails, so it works as a CI step as-is.

## In CI

```yaml
- run: npm ci
- run: npx aitg scan --base origin/main
```

Fetch enough history for the merge-base to resolve
(`actions/checkout` with `fetch-depth: 0`).

## Requirements

- Node 18+
- A git repository
- A test suite that passes on its own -- mutation testing needs a green
  baseline to compare against

## Troubleshooting

Run `aitg doctor` first; it checks Node, git, the config, and which test
runner was detected.

Failures name their own cause. If one doesn't, `AITG_DEBUG=1 npx aitg scan`
prints Stryker's full output.

## License

MIT
