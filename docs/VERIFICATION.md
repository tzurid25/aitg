# Pre-publish verification

What has actually been run, and what has not. Kept honest because the CLI is
about to be public, and a README that overstates is worse than no README.

## Verified end-to-end

Run against a clean project, using **only the packed tarball** — no monorepo
on the path, dependencies installed from the registry.

| | Result |
| --- | --- |
| `npm install <tarball>` in an empty project | installs, 0 vulnerabilities |
| No `workspace:` refs in the published manifest | confirmed absent |
| `aitg --version`, `--help` | work standalone |
| `aitg scan` on a real git diff | 11 mutants, correct surface (`src/orders.js:11-16`) |
| Stryker resolved from the **user's** project | works |
| Weak test detected | `expect(typeof discountFor(600,true)).toBe("number")` — full coverage, caught nothing |
| Quality gate exit code | `1` — CI fails correctly |
| `report.md` + `fix-prompt.md` generated | yes |
| Local scan without an account | works, as the free tier promises |
| `aitg doctor` | reports accurately |

## Fixed during this verification

**Duplicate line numbers.** Stryker can emit the same mutation twice on one
line at different columns, which rendered as `2 places — lines 13, 13`. The
finding was correct but the presentation made the whole report look
unreliable. Lines are now deduplicated, and `occurrences` counts distinct
lines rather than raw mutants — the user is being told how many places to fix.

**`doctor` reported a false green.** When not signed in, the API check
returned "reachable" *without making any network request*. Doctor is the first
thing someone runs when a scan misbehaves, so a wrong answer there sends them
looking in the wrong place. It now calls `/api/health` with a 5s timeout and
says plainly that local scans work regardless.

## NOT verified — do not claim these work

- **CLI → cloud upload.** The HTTP path from `aitg scan` to a running API has
  never been exercised. Local scanning is proven; uploading is not.
- **Device login (`aitg login`).** The full browser round trip has not been
  run against a live server.
- **GitHub App.** No App has been registered, so webhooks, check runs, PR
  comments, and one-click connect are unproven against real GitHub.
- **Deployment.** Everything so far has run on localhost. No Dockerfile, no
  production deploy.

## Consequence for launch

The **CLI is publishable today** — its value works standalone and is proven.
The cloud side is not proven and should not be advertised until it is.

That ordering is convenient rather than awkward: open-sourcing the CLI first
is the plan anyway, and the paid surface can be announced once it has been
exercised against a live deployment.
