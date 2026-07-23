# AI Test Integrity Guard (aitg) — Monorepo

Phase 1 status: **Foundation** ✅ — Turborepo workspace, TypeScript base
config, Prisma schema/client, Postgres + Redis local infra, usage-quota
fields on `Organization`.

Phase 2 status: **CLI foundation** ✅ — `aitg login/logout/init/link/scan/
report/doctor/update` are fully wired (auth, config, API client, repo
identity). `aitg scan` intentionally stops with a clear error where the
Phase 3 (git diff engine) and Phase 4 (Stryker mutation engine) plug in —
those aren't built yet.

Phase 3 status: **Git diff engine** ✅ — merge-base (three-dot) diff
resolution, changed-file detection with rename tracking, unified-diff hunk
parsing to exact post-image line ranges, and production-code filtering.
Exposed today via `aitg scan --dry-run`, which prints the exact mutation
surface a scan would cover.

Phase 4 status: **Mutation engine** ✅ — programmatic StrykerJS integration
scoped to the Phase 3 line ranges, test-runner auto-detection, mutation
scoring, quality-gate evaluation with CI exit codes, and generation of both
`report.md` and `fix-prompt.md`.

Phase 5 status: **Cloud API** ✅ — `apps/api` (Next.js Route Handlers) with
API-key authentication, device-code CLI login, tenant-scoped endpoints,
atomic quota enforcement, and BullMQ workers. `packages/shared` holds the
Zod contract shared by CLI, API, and dashboard.

Phase 6 status: **Dashboard** ✅ — `packages/ui` (design system + the
MutationStrip readout) and `apps/web` (NextAuth with GitHub/Google/password,
the `/cli-login` device-approval flow that unblocks `aitg login`, the full
dashboard, and the public landing page).

## Structure

```
/
  turbo.json
  package.json
  pnpm-workspace.yaml
  docker-compose.yml
  tsconfig.base.json
  .env.example

/apps
  /web          (Phase 6 — customer dashboard)
  /api          (Phase 5 — backend services)

/packages
  /cli          (Phase 2 — aitg CLI)
  /database     (Phase 1 — Prisma schema, migrations, client) ✅
  /shared       (Phase 5+ — shared types/DTOs/validation)
  /ui           (Phase 6 — reusable UI system)
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`corepack enable` will install the pinned version automatically)
- Docker + Docker Compose

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env and adjust if needed (defaults match docker-compose.yml)
cp .env.example .env

# 3. Start local Postgres + Redis
pnpm docker:up

# 4. Generate the Prisma client
pnpm db:generate

# 5. Run the initial migration (creates all Phase 1 tables)
pnpm db:migrate
# You'll be prompted for a migration name the first time, e.g. "init"

# 6. (Optional) Seed a local dev org/user
pnpm --filter @aitg/database db:seed

# 7. (Optional) Inspect the database visually
pnpm db:studio
```

## Data model (Phase 1)

Tenant boundary: `Organization`. Every domain table carries an indexed
`organizationId` for query-level tenant isolation, even where it's also
reachable via a relation chain (e.g. `Mutant -> TestRun -> Repository ->
Project -> Organization`) — this keeps every API query a single-hop
`WHERE organizationId = ?` instead of a multi-join filter.

Entities: `Organization`, `User`, `Membership` (join table carrying RBAC
role: Owner/Admin/Developer/Viewer), `Project`, `Repository`, `ApiKey`
(stores a hash only, never the raw key), `TestRun`, `Mutant`, `QualityGate`
+ `QualityGateResult`, `BillingInvoice`, `WebhookEvent`, `AuditLog`.

## CLI (Phase 2)

```bash
cd packages/cli
pnpm install
pnpm build          # bundles to dist/index.js via tsup
node dist/index.js --help

# Or install it globally from your local build:
npm link
aitg --help
```

Point the CLI at a local API instead of the production one:

```bash
export AITG_API_URL="http://localhost:3001"
```

Commands: `login`, `logout`, `init`, `link`, `scan`, `report`, `doctor`, `update`.
`scan` and `report --json` will error clearly until Phase 3/4 land — everything
else (auth, config, repo linking, diagnostics, self-update) works today.

## Diff engine (Phase 3)

Lives in `packages/cli/src/engine/`. Runs entirely on the developer's
machine — no code is uploaded to compute the diff.

```bash
# Inspect exactly what a scan would mutate, without running mutations
aitg scan --dry-run

# Diff against a specific base branch
aitg scan --dry-run --base origin/develop

# Include uncommitted working-tree changes
aitg scan --dry-run --uncommitted
```

Design notes:
- **Three-dot semantics.** Diffs against `merge-base(base, HEAD)`, not the
  tip of base, so commits landed on base after you branched don't inflate
  your mutation surface (and your quota).
- **Post-image line numbers.** Hunk headers `@@ -a,b +c,d @@` are parsed and
  the body walked, advancing only on context/addition lines. Deletions exist
  only in the pre-image and yield nothing mutable.
- **Filtering happens before line mapping**, so exclusion cost is O(files),
  not O(lines). Test files are excluded as *targets* — they do the killing,
  not the dying.
- **Pure renames are dropped**: no added lines means nothing new to mutate.

## Mutation engine (Phase 4)

Lives in `packages/cli/src/mutation/`. Runs StrykerJS **on the developer's
machine** — source code never leaves it; only the resulting report is
uploaded. This is what keeps our cloud compute cost near zero.

### Required in the user's project

```bash
npm install --save-dev @stryker-mutator/core
# plus the plugin for your runner, e.g.
npm install --save-dev @stryker-mutator/vitest-runner
```

Stryker is an optional peer dependency of the CLI and is imported
dynamically, so `login`, `init`, `doctor`, `report`, and `scan --dry-run`
all work without it installed.

### Cost controls (these are the product's economics)

Mutation testing naively re-runs the entire suite once per mutant. Three
settings make it viable:

1. **Line-scoped `mutate`** — Stryker is pointed at `file:start-end` ranges
   from the diff engine, not whole files.
2. **`coverageAnalysis: "perTest"`** — only the tests that actually cover a
   mutant are run against it, not the whole suite.
3. **`incremental: true`** — unchanged files reuse prior results across runs.

Plus a per-mutant `timeoutMS` so an infinite-loop mutant can't pin a worker,
and a trimmed high-signal mutator set (conditionals, equality, booleans,
logical/arithmetic operators) instead of Stryker's full ~20.

### Scoring

`score = (killed + timedOut) / (killed + survived + timedOut) * 100`

`NO_COVERAGE` mutants are excluded from the denominator — matching Stryker's
"score based on covered code" convention so the number is comparable to a
standalone run. They're surfaced separately in the report, since uncovered
changed code is its own problem.

### Outputs

- `.test-guard/report.md` — human-readable verdict, score table, and every
  surviving mutant grouped by file.
- `.test-guard/fix-prompt.md` — a ready-to-paste LLM prompt. Deliberately
  constrains the model against the two ways an AI "fixes" a surviving mutant
  wrongly: asserting the mutated behaviour, or weakening production code.

Exit code is `1` when the gate fails and `failBuildOnBreach` is set, so
`aitg scan` drops into CI as a blocking step with no extra wiring.

## Cloud API (Phase 5)

```bash
# Terminal 1 — API server (port 3001)
pnpm api:dev

# Terminal 2 — background workers
pnpm api:workers

# Point the CLI at your local API
set AITG_API_URL=http://localhost:3001    # Windows
export AITG_API_URL=http://localhost:3001 # macOS/Linux
```

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness + DB readiness (503 if DB is down) |
| `POST` | `/api/cli/auth/device` | Start device-code login |
| `POST` | `/api/cli/auth/device/poll` | Poll for approval, receive API key |
| `GET` | `/api/cli/whoami` | Identity + current quota |
| `GET` | `/api/cli/projects` | List projects in the org |
| `POST` | `/api/cli/repositories/link` | Idempotent repo registration |
| `POST` | `/api/cli/scans` | Upload a mutation report |

### Security model

- **API keys** are `aitg_live_<32 random bytes>`, stored as a SHA-256 hash.
  Only a 16-char display prefix is kept in the clear, so the dashboard can
  label keys without holding secrets. SHA-256 rather than bcrypt is
  deliberate: these are high-entropy random secrets, so a slow KDF adds
  latency to every request and buys nothing.
- **Every auth failure returns an identical 401.** Distinguishing "revoked"
  from "unknown" would confirm the existence of valid key material.
- **Tenant isolation runs through one function**, `scopedWhere(auth)`. Every
  org-owned query spreads it into `where`. One auditable choke point beats a
  convention repeated across dozens of call sites, where a single omission is
  a cross-tenant leak.
- **Device-code login** mints the API key on the CLI's poll response, not in
  the browser — so the plaintext key crosses exactly one channel and is never
  rendered in a web page or held in a session.

### Quota enforcement

Consumed at **upload**, because that's the meterable event: mutation compute
runs on the developer's machine, not ours. `consumeQuota` does check and
increment in a single conditional `updateMany`, so two concurrent CI jobs
can't both observe "under limit" and both proceed — the loser gets a `402`.
Rejection happens before any rows are written, so an over-quota report is
never persisted.

The period rolls over lazily on first request of a new month, which avoids
needing a scheduled job to reset dormant organizations.

## Next steps (do not start without approval)

Phase 6 — Dashboard (`apps/web` + `packages/ui`): SaaS UI, reports,
analytics, quality-gate configuration.

## Dashboard (Phase 6)

```bash
# One-time: generate an auth secret and put it in .env as NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm db:seed     # 3 projects, 30 runs, ~4000 mutants
pnpm web:dev     # http://localhost:3000
```

GitHub sign-in needs an OAuth App (Settings → Developer settings → OAuth
Apps) with callback `http://localhost:3000/api/auth/callback/github`, then
`GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` in `.env`. Providers
register conditionally, so the app boots fine with only some configured —
email/password always works.

**Note:** the GitHub *OAuth App* (sign-in) and the GitHub *App* (repository
access, Phase 7) are separate registrations. One does not grant the other.

### Auth design

No Prisma adapter. The adapter insists on its own Account/Session/
VerificationToken tables that would duplicate the User and Membership model
this product already owns. Instead: JWT sessions, plus a `signIn` callback
that reconciles the user into our tables and guarantees they own at least one
organization — a user with no org would land on a dashboard with nothing to
show and no way to create anything.

`/cli-login` is what closes the CLI auth loop. `aitg login` creates a
DeviceAuthSession and polls; nothing could move it out of `PENDING` until a
human proved who they were, and that proof is this page's session cookie. The
API key is still minted by `apps/api` on the CLI's next poll, never here — so
the plaintext secret only ever crosses the CLI's own HTTPS response.

### The mutation strip

Every run renders its mutants as cells in a dense grid rather than a donut
chart. "8 survived of 340" is a number you read; eight amber cells in a field
of teal is something you see first. Survivors sort first so truncation on huge
runs can never hide them, killed cells sit at 45% opacity so they don't
compete, and clicking a cell scrolls the matching row into view in the ledger
below — which is what makes it an instrument rather than decoration.

### Colour semantics

`SURVIVED` is amber, not red. A surviving mutant is a blind spot, not a broken
build; red stays reserved for genuine failures so the signal means something.
`NO_COVERAGE` is a desaturated violet-gray — absence, not failure.

## Next steps (do not start without approval)

Phase 7 — GitHub integration (GitHub App, webhooks, PR check runs and
comments).

## Survivor triage (Phase 6.1)

A real scan produces hundreds of surviving mutants. Handing all of them to a
developer — or to an LLM — produces a report nobody acts on. Three
transformations in `packages/shared/src/triage.ts` turn that list into a task:

**Deduplicate.** The same mutation at forty different lines is one testing
gap repeated, not forty problems. A representative 92-survivor run collapses
to 33 distinct gaps.

**Rank.** Base severity comes from the mutator class — a surviving
`EqualityOperator` means a decision was inverted unnoticed, while a surviving
`UpdateOperator` is often a loop counter. That's escalated one tier when the
mutated line touches access control, money, or crypto.

Two details that matter, both found by testing the ranking rather than
assuming it:

- Sensitivity matches the **mutated source line**, not the file path.
  Matching the path tagged every unrelated counter inside `billing/` as a
  monetary risk.
- Escalation happens **at most once**. An earlier version also escalated for
  recurrence; stacking pushed nearly every group to `critical`, and a ranking
  where everything is critical carries no information. Recurrence is a sort
  tiebreaker instead.

The corrected spread on that same run is 3 critical / 17 high / 8 medium /
5 low — and the three critical entries are the permission-check inversions.

**Cap at ten.** With a plain statement of how many were held back and how to
get them. The prompt drops from ~11,000 characters to ~4,200: a batch a
developer will finish, rather than an audit they'll defer.

The dashboard also offers per-file scoping, because fixing one file at a time
is how this work actually gets done — a prompt spanning five files produces a
change set nobody wants to review.

Generation lives in `@aitg/shared` so the CLI's `fix-prompt.md` and the
dashboard's copy button emit identical text. Two implementations would drift,
and a developer who noticed them disagreeing would rightly stop trusting both.

## Rate limiting (Phase 7.2)

Quota and rate limiting are different controls and both are needed. Quota is a
*billing* limit measured in mutants per month; it says nothing about arrival
rate. A caller can sit well inside their monthly quota and still saturate the
database — or, far more commonly, a misconfigured CI loop retries forever and
burns a customer's entire quota in minutes.

| Endpoint | Limit | Keyed by |
| --- | --- | --- |
| `POST /api/cli/scans` | 30/hour | organization |
| `POST /api/cli/auth/device` | 10/10min | IP |
| `POST /api/cli/auth/device/poll` | 200/10min | IP |

Uploads get the tightest limit because each one writes thousands of rows. The
check runs *before* body parsing, so a retry loop can't make us deserialize a
multi-megabyte report just to reject it.

Fixed window in Redis, not a token bucket. A fixed window permits up to 2x
across a boundary; that's acceptable here because these limits exist to stop
runaway loops and abuse, not to shape traffic precisely — and the tradeoff
buys one atomic `INCR` per request instead of a read-modify-write.

**Fails open.** If Redis is unreachable, requests are allowed and the failure
is logged. Quota still bounds cost, and refusing every upload because a cache
is down would be a self-inflicted outage.

## Publishing the CLI

`@aitg/shared` is a **devDependency**, not a dependency. tsup bundles it into
`dist/index.js`, so the artifact has no runtime reference — but listing it
under `dependencies` would publish `"@aitg/shared": "workspace:*"` to npm, and
every `npm install -g @aitg/cli` would fail with `Unsupported URL Type
"workspace:"`. It works locally and breaks only for users, which is the worst
shape a bug can have.

See `packages/cli/PUBLISHING.md` for the pre-publish check.

## Security

`SECURITY.md` holds six rules. Each was written because a specific bug reached
this codebase — they are not general advice.

The one that mattered most: `/api/github/callback` bound an
attacker-controlled `installation_id` to the caller's organization without
verification. GitHub issues those ids sequentially, so anyone with a free
account could guess a customer's id and take over their repositories,
including write access to Actions secrets.

Fixed by verifying entitlement against GitHub itself — exchange the one-time
`code` for a user token, confirm the installation appears in that user's own
list, and refuse to re-bind an installation owned by another organization.

```bash
pnpm security:audit
```

Enumerates every route handler and flags any that reads a caller-supplied
identifier without a tenant-scoped lookup or a written `SECURITY-REVIEWED:`
justification. Crude by design — grep, not analysis — because a precise
checker is a research project and a crude one that runs on every merge catches
the class of mistake that actually happens.

Verified against a reconstruction of the original bug: it flags it HIGH.

## Run severity (P0 before P1–P3)

A scan that *broke* and a scan that *ran and found weak tests* are different
events, and conflating them is how a dead pipeline hides for weeks. Stryker
crashing produces a score of 0 or none at all — rendering that as "score too
low" tells a team to go write tests when the real problem is that their scan
hasn't run since Tuesday.

| Severity | Meaning | Blocks |
| --- | --- | --- |
| `P0_SCAN_BROKEN` | Could not run, or produced zero mutants | yes |
| `P1_GATE_FAILED` | Ran fine, below threshold, blocking gate | yes |
| `P2_GATE_WARNING` | Ran fine, below threshold, warn-only gate | no |
| `P3_HEALTHY` | Ran fine, above threshold | no |

P0 is checked before any gate outcome, so a crashed scan whose gate reported
`PASSED` still resolves to P0 — that specific case is the one that would
otherwise hide a broken pipeline.

A completed run with **zero mutants** is also P0. It's nearly always a
misconfiguration (wrong paths, over-broad excludes, a diff matching nothing),
and reporting it as a perfect score would be actively misleading.

The run detail page suppresses the score entirely under P0 rather than showing
0%.

## Session replay

Every scan can attach a replay record so support questions are answerable
without guesswork: tool versions settle "works on my machine", per-stage
timings settle "why is this slow", and the failure stage settles "where did it
break".

**It stores no source code.** No file contents, no mutated code bodies, no
verbatim test output — the product promises source stays on the customer's
machine, and a debugging convenience is not worth breaking that. Paths, line
ranges, versions, timings, and error messages resolve the overwhelming
majority of cases.

Belt and braces: `sanitizeReplay()` truncates failure messages and strips
long quoted fragments, because test-runner errors routinely embed source lines
in their output.

Anything beyond that is opt-in, attached deliberately by the customer.
