import { prisma, type MembershipRole, type ApiKeyScope } from "@aitg/database";
import { extractBearerToken, hashApiKey } from "./api-keys";

export interface AuthContext {
  organizationId: string;
  organizationSlug: string;
  apiKeyId: string;
  scope: ApiKeyScope;
  /** Null for machine keys created outside a user session. */
  userId: string | null;
  userEmail: string | null;
}

export class ApiAuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiAuthError";
  }
}

/**
 * Resolves an API key into an AuthContext, or throws.
 *
 * Every failure mode returns the same generic 401 message. Telling a caller
 * "this key exists but is revoked" versus "this key does not exist" would
 * confirm the existence of valid key material to someone probing.
 */
export async function authenticateRequest(request: Request): Promise<AuthContext> {
  const token = extractBearerToken(request.headers.get("authorization"));

  if (!token) {
    throw new ApiAuthError("Authentication required.", 401, "UNAUTHENTICATED");
  }

  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(token) },
    include: {
      organization: { select: { id: true, slug: true } },
      createdByUser: { select: { id: true, email: true } },
    },
  });

  const invalid = () =>
    new ApiAuthError("Invalid or expired credentials.", 401, "UNAUTHENTICATED");

  if (!apiKey) throw invalid();
  if (apiKey.revokedAt) throw invalid();
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) throw invalid();

  // Fire-and-forget: lastUsedAt is for the dashboard's "when was this key
  // last seen" column. Awaiting it would add a write to the critical path of
  // every authenticated request for no functional benefit.
  void prisma.apiKey
    .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return {
    organizationId: apiKey.organizationId,
    organizationSlug: apiKey.organization.slug,
    apiKeyId: apiKey.id,
    scope: apiKey.scope,
    userId: apiKey.createdByUser?.id ?? null,
    userEmail: apiKey.createdByUser?.email ?? null,
  };
}

/**
 * Guards an endpoint against keys that shouldn't reach it. A CLI_SCAN key
 * leaked from a CI log must not be usable to read the whole organization or
 * mutate settings.
 */
export function requireScope(auth: AuthContext, allowed: ApiKeyScope[]): void {
  if (!allowed.includes(auth.scope)) {
    throw new ApiAuthError(
      "This API key does not have permission for this operation.",
      403,
      "INSUFFICIENT_SCOPE",
    );
  }
}

const ROLE_RANK: Record<MembershipRole, number> = {
  VIEWER: 0,
  DEVELOPER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export async function requireRole(
  auth: AuthContext,
  minimum: MembershipRole,
): Promise<void> {
  if (!auth.userId) {
    throw new ApiAuthError(
      "This operation requires a user-scoped key.",
      403,
      "USER_CONTEXT_REQUIRED",
    );
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: auth.organizationId,
        userId: auth.userId,
      },
    },
    select: { role: true },
  });

  if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minimum]) {
    throw new ApiAuthError(
      "Insufficient permissions for this operation.",
      403,
      "INSUFFICIENT_ROLE",
    );
  }
}

/**
 * The single tenant-scoping helper. Every query touching org-owned data must
 * spread this into its `where` clause. Centralising it means tenant isolation
 * is one auditable function rather than a convention scattered across dozens
 * of call sites where a single omission is a data leak.
 */
export function scopedWhere<T extends Record<string, unknown>>(
  auth: AuthContext,
  where: T = {} as T,
): T & { organizationId: string } {
  return { ...where, organizationId: auth.organizationId };
}
