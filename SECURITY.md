# Security rules

These are not general advice. Each one is written because a specific bug got
into this codebase, and the rule is what would have caught it.

---

## Rule 1 — Never trust a caller-supplied identifier

**The bug.** `/api/github/callback` took `installation_id` from the query
string and bound it to whatever organization the caller belonged to. GitHub
issues installation ids sequentially, so anyone with a free account could
guess a customer's id, hit the endpoint, and take over their repositories —
including write access to their Actions secrets.

**The rule.** Any identifier that arrives from outside — query string, request
body, path parameter, header — is a *claim*, not a fact. Before it is used,
one of these must be true:

1. It resolves through a **tenant-scoped query** (`scopedWhere(auth)` /
   `scoped(session)`), so a foreign id simply returns nothing; or
2. Entitlement is **verified against the issuing authority** (as the fixed
   callback now does, by asking GitHub which installations this user
   administers); or
3. Possession of the id *is* the secret, and it is high-entropy, single-use,
   rate-limited, and expiring (device codes, API keys).

If none apply, the endpoint is vulnerable. There is no fourth option.

**Concretely, this is wrong:**

```ts
const id = body.repositoryId;
const repo = await prisma.repository.findUnique({ where: { id } });  // any tenant's
```

**This is right:**

```ts
const repo = await prisma.repository.findFirst({
  where: scopedWhere(auth, { id: body.repositoryId }),   // returns null across tenants
});
```

`findUnique` cannot be tenant-scoped, because it only accepts unique fields.
That makes `findUnique` on a caller-supplied id a smell in itself — prefer
`findFirst` with a scoped `where`.

---

## Rule 2 — Read authorization and write authorization are different

Being able to *see* a resource does not imply being able to *bind, modify, or
connect* it. `/api/github/setup` checks `hasRole(session, "ADMIN")` before
writing to a customer's repository, because writing secrets and opening pull
requests is not something a VIEWER should reach.

Any endpoint with a side effect outside our own database needs an explicit
role check, not just a session.

---

## Rule 3 — Device-code flows are phishable, and the UI cannot fix it

**The residual risk.** An attacker runs `aitg login` on their own machine,
gets a code, and persuades someone inside a target organization to enter it.
The victim approves; the attacker's CLI receives a key scoped to the victim's
organization. This is a real attack pattern, used in the wild against Azure AD
device-code login.

Nothing in the protocol distinguishes that approval from a legitimate one, so
the mitigations are layered rather than absolute:

- The approval screen names the organization being granted access and states
  what approving does.
- Codes expire in 10 minutes.
- Approvals are **rate-limited to 10/hour per user**.
- **Every approval is written to the audit log**, so an owner can see which
  devices were ever authorised and by whom.

The last one is the important one. Prevention is imperfect here, so detection
has to be reliable.

---

## Rule 4 — Fail closed on authorization, open on availability

Two failure modes, opposite defaults:

- **Cannot verify entitlement?** Refuse. The fixed callback returns
  `missing_code` rather than binding an installation it could not verify.
- **Cannot reach a non-security dependency?** Continue. Rate limiting allows
  the request when Redis is down and logs it, because a cache outage should
  not become a product outage. Quota still bounds cost.

The distinction: never fail open on *authorization*; prefer failing open on
*infrastructure*.

---

## Rule 5 — Secrets travel one path, and never through logs

- API keys are stored as SHA-256 hashes. Only a 16-character display prefix
  is kept readable.
- The plaintext key exists exactly twice: in the CLI's poll response, and in
  the sealed box written to GitHub Actions secrets. It is never rendered in a
  browser, never returned by a read endpoint, and never logged.
- If setup fails after a key is minted, that key is **revoked immediately**.
  An orphaned live credential after a failed flow is how incidents start.
- Audited: no `logger` call in the CLI receives `creds.apiKey`. Only email
  and organization slug are ever printed.

---

## Rule 6 — Every auth failure returns the same response

`authenticateRequest` returns an identical 401 for a missing key, an unknown
key, a revoked key, and an expired key. Distinguishing them confirms to a
prober which key material exists.

The same reasoning applies to the device-poll endpoint: an unknown device code
reports `expired`, not `not found`.

---

## The check

`pnpm security:audit` enumerates every route handler and flags any that reads
a caller-supplied identifier without a scoped lookup or an explicit
verification comment. It is not a substitute for review — it catches the exact
shape of Rule 1, which is the one that actually bit us.

Run it before every merge that touches an endpoint.
