import { redisConnection } from "./queues.js";
import type { AuthContext } from "./auth.js";

/**
 * Rate limiting.
 *
 * Quota and rate limiting solve different problems and both are needed.
 * Quota is a *billing* control measured in mutants per month; it says nothing
 * about how fast requests arrive. A caller can sit well inside their monthly
 * quota and still hammer the upload endpoint hard enough to saturate the
 * database — or, more mundanely, a misconfigured CI loop can retry forever
 * and exhaust a customer's quota in minutes.
 *
 * Implemented as a fixed window in Redis rather than a token bucket. A fixed
 * window allows a burst of up to 2x across a boundary, which is acceptable
 * here: these limits exist to stop runaway loops and abuse, not to shape
 * traffic precisely. The tradeoff buys a single atomic INCR per request
 * instead of a read-modify-write.
 */

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Uploads are the expensive path — each one writes thousands of rows — so
 * they get the tightest limit. Reads are cheap and generous.
 */
export const RATE_LIMITS = {
  scanUpload: { limit: 30, windowSeconds: 3600 },
  read: { limit: 600, windowSeconds: 60 },
  deviceAuth: { limit: 10, windowSeconds: 600 },
  devicePoll: { limit: 200, windowSeconds: 600 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly result: RateLimitResult,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Consumes one unit against a key.
 *
 * The INCR is atomic, so concurrent requests cannot both observe "under
 * limit". The TTL is set only on first increment — resetting it on every
 * request would turn a fixed window into a sliding one that never expires
 * under sustained load, and the limit would become permanent.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const redis = redisConnection as unknown as {
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    ttl(key: string): Promise<number>;
  };

  const namespaced = `ratelimit:${key}`;

  let count: number;
  try {
    count = await redis.incr(namespaced);
    if (count === 1) {
      await redis.expire(namespaced, rule.windowSeconds);
    }
  } catch (err) {
    // Fail OPEN, deliberately. A Redis outage should degrade rate limiting,
    // not take the product down — the quota check still bounds cost, and
    // refusing every upload because a cache is unreachable would be a
    // self-inflicted outage.
    console.error("[ratelimit] Redis unavailable, allowing request:", err);
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit,
      resetSeconds: rule.windowSeconds,
    };
  }

  let resetSeconds = rule.windowSeconds;
  try {
    const ttl = await redis.ttl(namespaced);
    if (ttl > 0) resetSeconds = ttl;
  } catch {
    // Non-fatal; the reported reset time is cosmetic.
  }

  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetSeconds,
  };
}

/** Throws a 429 when the caller is over their limit. */
export async function enforceRateLimit(
  key: string,
  rule: RateLimitRule,
  description: string,
): Promise<RateLimitResult> {
  const result = await consumeRateLimit(key, rule);

  if (!result.allowed) {
    const minutes = Math.ceil(result.resetSeconds / 60);
    throw new RateLimitError(
      `Rate limit exceeded for ${description}: ${result.limit} per ` +
        `${rule.windowSeconds >= 3600 ? "hour" : `${rule.windowSeconds}s`}. ` +
        `Try again in ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
        "If this is a CI loop, check that it isn't retrying on failure.",
      result,
    );
  }

  return result;
}

/** Per-organization key. Preferred: limits should follow the tenant. */
export function orgKey(auth: AuthContext, bucket: string): string {
  return `org:${auth.organizationId}:${bucket}`;
}

/**
 * Per-IP key, for endpoints that run before authentication.
 *
 * Reads the first entry of X-Forwarded-For, which is the client as seen by
 * the outermost proxy. This is spoofable if the app is exposed directly, so
 * it must sit behind a proxy that overwrites the header.
 */
export function ipKey(request: Request, bucket: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `ip:${ip}:${bucket}`;
}
