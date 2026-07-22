import crypto from "node:crypto";

/**
 * API keys are high-entropy random secrets, not user-chosen passwords.
 * That distinction drives the hashing choice: bcrypt/argon2 exist to make
 * brute-forcing *low-entropy* secrets expensive. Against 256 bits of CSPRNG
 * output, brute force is already infeasible, so a slow KDF would only add
 * latency to every single authenticated request without adding security.
 * SHA-256 is the correct tool here.
 */

const KEY_PREFIX = "aitg_live_";
const PREFIX_DISPLAY_LENGTH = KEY_PREFIX.length + 6;

export interface GeneratedApiKey {
  /** Shown to the user exactly once, never persisted. */
  plaintext: string;
  /** Persisted, used for lookup. */
  hash: string;
  /** Persisted in the clear so the dashboard can identify the key. */
  displayPrefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const secret = crypto.randomBytes(32).toString("base64url");
  const plaintext = `${KEY_PREFIX}${secret}`;

  return {
    plaintext,
    hash: hashApiKey(plaintext),
    displayPrefix: plaintext.slice(0, PREFIX_DISPLAY_LENGTH),
  };
}

export function hashApiKey(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Extracts a bearer token from an Authorization header. Returns null rather
 * than throwing so callers can produce a uniform 401 without branching on
 * *why* the header was unusable — distinguishing "missing" from "malformed"
 * in the response would leak information to a probing client.
 */
export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;

  return token.trim() || null;
}

/**
 * Constant-time comparison. Used for the paths where we compare a derived
 * value directly rather than via an indexed DB lookup.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Device auth codes
// ---------------------------------------------------------------------------

/** Ambiguous characters (0/O, 1/I/L) removed — these get read aloud and typed. */
const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateUserCode(): string {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += USER_CODE_ALPHABET[(bytes[i] as number) % USER_CODE_ALPHABET.length];
    if (i === 3) code += "-";
  }
  return code;
}

export function generateDeviceCode(): { plaintext: string; hash: string } {
  const plaintext = crypto.randomBytes(32).toString("base64url");
  return {
    plaintext,
    hash: crypto.createHash("sha256").update(plaintext, "utf8").digest("hex"),
  };
}
