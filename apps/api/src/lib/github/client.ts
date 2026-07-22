import crypto from "node:crypto";

/**
 * GitHub App authentication.
 *
 * Two token types, and the distinction matters:
 *
 *  - An **App JWT**, signed with the app's private key, identifies the app
 *    itself. It can only list installations and mint installation tokens.
 *    Valid for at most 10 minutes.
 *  - An **installation token**, obtained with that JWT, is what actually
 *    touches repositories. It expires after an hour and is scoped to exactly
 *    the repos the installer granted.
 *
 * This is why the App is separate from the OAuth App used for sign-in: the
 * OAuth token belongs to a person and dies when they leave. An installation
 * token belongs to the installation, so CI keeps working.
 */

const GITHUB_API = "https://api.github.com";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not configured. GitHub integration is unavailable until it is set.`,
    );
  }
  return value;
}

/**
 * Signs a short-lived JWT (RS256) proving we are the app.
 *
 * Implemented directly rather than pulling in a JWT library: this is one
 * fixed algorithm with two claims, and the private key handling is clearer
 * without a layer of abstraction over it.
 */
export function createAppJwt(): string {
  const appId = requiredEnv("GITHUB_APP_ID");
  // GitHub hands you a PEM with real newlines; environment variables usually
  // carry it with literal "\n". Accept both rather than making deployment a
  // guessing game.
  const privateKey = requiredEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    // Backdated by a minute to tolerate clock skew between us and GitHub —
    // an "iat is in the future" rejection is otherwise intermittent and
    // maddening to diagnose.
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");

  const unsigned = `${encode(header)}.${encode(payload)}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(privateKey)
    .toString("base64url");

  return `${unsigned}.${signature}`;
}

interface InstallationToken {
  token: string;
  expiresAt: Date;
}

// Installation tokens last an hour; re-minting one per API call would waste a
// round trip and burn rate limit. Cached in memory with a safety margin.
const tokenCache = new Map<string, InstallationToken>();
const TOKEN_SAFETY_MARGIN_MS = 5 * 60 * 1000;

export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt.getTime() - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  const response = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createAppJwt()}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Could not obtain an installation token (${response.status}). ` +
        `The app may have been uninstalled. ${detail.slice(0, 200)}`,
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const token: InstallationToken = {
    token: data.token,
    expiresAt: new Date(data.expires_at),
  };
  tokenCache.set(installationId, token);

  return token.token;
}

/**
 * Verifies a webhook signature.
 *
 * Two things here are load-bearing. The digest must be computed over the
 * RAW body — re-serializing parsed JSON changes whitespace and key order, and
 * the signature will never match. And the comparison must be constant-time,
 * because a byte-by-byte early exit leaks the expected digest to anyone
 * willing to measure response times.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

export function isGithubConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID &&
      process.env.GITHUB_APP_PRIVATE_KEY &&
      process.env.GITHUB_WEBHOOK_SECRET,
  );
}

// ---------------------------------------------------------------------------
// Thin API wrapper
// ---------------------------------------------------------------------------

export interface GithubRequestOptions {
  installationId: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

export async function githubRequest<T>(options: GithubRequestOptions): Promise<T> {
  const token = await getInstallationToken(options.installationId);

  const response = await fetch(`${GITHUB_API}${options.path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub ${options.method ?? "GET"} ${options.path} failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
