# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Include the output of `aitg doctor`, and the failing command with
`AITG_DEBUG=1` set. That environment variable makes the tool print Stryker's
full output rather than its own summary, which is usually where the real cause
is.

If the tool told you *why* it failed and the explanation was wrong or useless,
that's worth reporting on its own. Unhelpful failure messages are treated as
bugs here — see [KNOWN-ISSUES.md](KNOWN-ISSUES.md) for the reasoning.

## Development

```bash
pnpm install
pnpm --filter @aitg/cli build
pnpm --filter @aitg/cli exec vitest run src/
```

The dashboard needs Postgres and Redis:

```bash
docker compose up -d
pnpm --filter @aitg/database db:generate
pnpm dev
```

## Tests

New behaviour needs a test, and the test has to be able to fail.

Before opening a PR, break the code your test covers on purpose and confirm
the test goes red. A test that passes against both the correct and the broken
implementation is worse than no test: it makes the gap look covered.

This is not a hypothetical. One test in this repo passed that check by
accident and had to be rewritten — the details are in
[KNOWN-ISSUES.md](KNOWN-ISSUES.md).

For the diff engine, prefer a real git fixture over a mocked one. The bugs
that engine has had were all about how git itself resolves paths, and a mock
would have returned whatever it was told to.

## Style

- TypeScript, strict.
- Comments explain *why*, not *what*. If a line looks odd but is deliberate,
  say what breaks without it.
- ASCII only in anything written to a file. Report output is read on Windows
  terminals that mangle anything else.

## Scope

`aitg` measures one thing: whether your assertions would notice if the code
changed. Proposals that broaden it past that will likely be declined, not
because they're bad but because a tool that does one thing well is easier to
trust.

The mutation work itself belongs to [StrykerJS](https://stryker-mutator.io/).
Bugs in mutation behaviour usually belong upstream.
