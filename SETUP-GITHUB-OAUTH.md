# Setting up GitHub sign-in

Five minutes, no cost. Do this once.

## 1. Register the OAuth App

Go to **https://github.com/settings/developers** → **OAuth Apps** →
**New OAuth App**.

| Field | Value |
| --- | --- |
| Application name | `AITG Local` |
| Homepage URL | `http://localhost:3000` |
| Authorization callback URL | `http://localhost:3000/api/auth/callback/github` |

The callback URL must match exactly — including the port and the path. A
mismatch is the single most common cause of `redirect_uri_mismatch`.

Click **Register application**.

## 2. Get the credentials

On the page that appears:

- **Client ID** is shown directly.
- **Client secret** requires clicking **Generate a new client secret**. It's
  shown once. Copy it now.

## 3. Put them in `.env`

Open `.env` in the repo root and fill in the two blank values:

```
GITHUB_OAUTH_CLIENT_ID="Ov23li..."
GITHUB_OAUTH_CLIENT_SECRET="the secret you just generated"
```

## 4. Restart

```
pnpm web:dev
```

The GitHub button on `/login` is now live. Providers register conditionally,
so leaving these blank simply hides the button rather than breaking the app.

---

## Important: this is not the GitHub App

This OAuth App handles **sign-in only**. Phase 7 needs a separate **GitHub
App** for repository access, webhooks, and PR checks — a different
registration, with its own ID, secret, and private key. One does not grant
the other, and they are configured independently.

## Google (optional)

Same shape, at https://console.cloud.google.com → APIs & Services →
Credentials → OAuth client ID (Web application). Redirect URI:
`http://localhost:3000/api/auth/callback/google`. Then fill
`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.
