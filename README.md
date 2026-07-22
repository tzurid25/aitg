# AI Test Integrity Guard

**Coverage is not quality. Mutation score is.**

AI writes tests that execute your code without ever checking what it does.
They pass. Coverage hits 100%. Then a bug ships through a line every report
said was tested.

`aitg` finds those tests. It makes small, deliberate changes to your changed
code -- flipping a `>=` to `>`, replacing a condition with `true` -- and
re-runs your suite. If nothing fails, that behaviour is executed but never
verified, and `aitg` tells you exactly where and what to assert.

It mutates only the lines in your diff, so it runs in seconds rather than
mutating the whole repository.

## Quick start

```bash
npm install --save-dev @aitg/cli @stryker-mutator/core
npx aitg init --local    # no account needed
npx aitg scan
```

See [`packages/cli/README.md`](packages/cli/README.md) for full usage.

## What it looks like

Given a classifier and a test suite that only checks "something was
returned":

```js
export function classify(score) {
  if (score >= 80) return "healthy";
  if (score >= 50) return "warning";
  return "critical";
}
```

```js
test("returns a value for a high score", () => {
  expect(classify(95)).toBeDefined();   // passes. verifies nothing.
});
```

Coverage reports 100%. `aitg` reports:

```
Mutation score: 0%
Survived: 8

! classify.js:2 (EqualityOperator)
! classify.js:3 (ConditionalExpression)
```

And writes a prompt you can paste into any coding assistant, naming each gap:

```diff
- if (score >= 80) return "healthy";
+ score > 80
```

> A comparison boundary was shifted (inclusive <-> exclusive) and no test
> noticed, so the exact edge value is untested. Assert the boundary itself,
> not just values on either side.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/cli` | The `aitg` command-line tool. This is the published package. |
| `packages/shared` | Report generation and triage logic, shared by CLI and dashboard. |
| `packages/database` | Prisma schema and client. |
| `packages/ui` | Design system for the dashboard. |
| `apps/web` | Dashboard: scan history and score over time. |
| `apps/api` | Cloud API backing the dashboard. |

The CLI works entirely offline. The dashboard and API are optional -- they add
history and team-level tracking.

## Development

```bash
pnpm install
pnpm --filter @aitg/cli build
pnpm --filter @aitg/cli exec vitest run src/
```

Local infrastructure for the dashboard (Postgres + Redis):

```bash
docker compose up -d
pnpm --filter @aitg/database db:generate
pnpm dev
```

## Testing

The CLI has 54 tests. They are validated by mutation rather than by coverage:
past defects are deliberately reintroduced to confirm the suite catches them.
One test failed that check during development and was strengthened -- the
details are in [`KNOWN-ISSUES.md`](KNOWN-ISSUES.md), along with every defect
found and fixed while getting the Stryker integration working.

The diff-engine tests build a real git repository per test rather than mocking
git, because the bugs they cover were about how git itself resolves pathspecs.

## Built on

[StrykerJS](https://stryker-mutator.io/) does the mutation testing. `aitg`
scopes it to your diff, picks the settings that keep it fast, and turns the
output into something you can act on.

## License

MIT
