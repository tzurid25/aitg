# Setting up the GitHub App (Phase 7)

This is **not** the OAuth App from `SETUP-GITHUB-OAUTH.md`. That one signs
people in. This one reads repositories, posts checks, and comments on pull
requests. Two separate registrations, two separate sets of credentials, and
neither grants what the other does.

## 1. Register

**https://github.com/settings/apps/new**

| Field | Value |
| --- | --- |
| GitHub App name | `AITG (yourname)` — must be globally unique |
| Homepage URL | `http://localhost:3000` |
| Callback URL | `http://localhost:3000/api/github/callback` |
| Request user authorization (OAuth) during installation | ✅ |
| Webhook URL | your public tunnel, e.g. `https://abc123.ngrok-free.app/api/webhooks/github` |
| Webhook secret | generate one (below) and paste it |

Generate a webhook secret:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Repository permissions

| Permission | Access | Why |
| --- | --- | --- |
| Checks | Read & write | Create the check run that blocks merge |
| Pull requests | Read & write | Post and update the report comment |
| Contents | **Read & write** | Open the setup pull request that adds the workflow |
| Secrets | **Read & write** | Set `AITG_API_KEY` so you never paste it by hand |
| Metadata | Read-only | Mandatory |

Contents and Secrets are write because of one-click connect: the dashboard
writes the API key into the repository's Actions secrets and opens a pull
request containing the workflow file. Nothing is pushed to your default
branch — you review a diff and merge it, or don't.

If you'd rather grant less, set Contents to read-only and skip Secrets
entirely; the manual instructions on the Integrations page still work.

### Subscribe to events

- Pull request
- Installation

Nothing else. Every extra event is a delivery we store and ignore.

## 2. Credentials

After creating the app:

- **App ID** is on the settings page.
- **Private key**: "Generate a private key" downloads a `.pem`. It is shown
  once.
- **Public page URL** ends in the app slug — that goes in
  `NEXT_PUBLIC_GITHUB_APP_SLUG`.

## 3. Fill `.env`

```
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET="the hex string you generated"
NEXT_PUBLIC_GITHUB_APP_SLUG="aitg-yourname"
```

The private key is multi-line. Either paste it with literal `\n` between
lines as shown, or keep real newlines inside the quotes — the loader accepts
both, because getting this wrong is otherwise a silent, confusing failure.

## 4. Webhooks on localhost

GitHub cannot reach `localhost`. Use a tunnel:

```
npx localtunnel --port 3001
```

Point the app's Webhook URL at `https://<tunnel>/api/webhooks/github`. The
tunnel URL changes each run, so update it when you restart.

Without a tunnel everything still works except the *pending* check that
appears when a PR opens. Scans still upload, and results still post.

## 5. Verify

1. `pnpm api:dev` and `pnpm web:dev`
2. Go to **Integrations** in the dashboard → **Install GitHub App**
3. Pick a repository
4. GitHub redirects to `/api/github/callback`, which binds the installation
   to your organization
5. The installation appears on the Integrations page
6. Click **Connect** next to a repository — the secret is set and a pull
   request opens automatically

## Connecting a repository

Two clicks, not four steps:

| | Manual | One-click |
| --- | --- | --- |
| Create `.github/workflows/aitg.yml` | you | done for you |
| Commit it | you | in the pull request |
| Generate an API key | you | minted per repository |
| Paste it into Actions secrets | you | written directly |
| **Your part** | 4 steps | review and merge |

Keys are minted **per repository** rather than shared, so revoking one
compromised CI key doesn't take down every other repo. If setup fails partway,
the key that was just created is revoked automatically rather than left
orphaned.

## How a scan reaches a pull request

```
PR opened
   ↓  webhook
AITG opens a PENDING check
   ↓
your CI runs `aitg scan`          ← mutation testing happens HERE, on your runner
   ↓  uploads report only
AITG concludes the check + comments on the PR
```

Your source code never reaches our servers. The uploaded report contains file
paths, line numbers, and mutation outcomes — not file contents.

The pending check is deliberate: a PR whose workflow never fired would
otherwise show no AITG status at all, which reads as "passed".
