import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "./auth-options";

export interface SessionContext {
  userId: string;
  email: string;
  name: string | null;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: string;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.organizationId) return null;

  return {
    userId: session.user.id,
    email: session.user.email ?? "",
    name: session.user.name ?? null,
    organizationId: session.user.organizationId,
    organizationSlug: session.user.organizationSlug,
    organizationName: session.user.organizationName,
    role: session.user.role,
  };
}

/**
 * Use in every dashboard page. Redirects rather than throwing so an expired
 * session lands the user on the login page instead of an error boundary.
 */
export async function requireSession(): Promise<SessionContext> {
  const context = await getSessionContext();
  if (!context) redirect("/login");
  return context;
}

/**
 * The dashboard's counterpart to the API's scopedWhere. Same reasoning: one
 * auditable function enforcing tenant isolation, rather than the convention
 * of remembering to add organizationId at every call site.
 */
export function scoped<T extends Record<string, unknown>>(
  session: SessionContext,
  where: T = {} as T,
): T & { organizationId: string } {
  return { ...where, organizationId: session.organizationId };
}

const ROLE_RANK: Record<string, number> = {
  VIEWER: 0,
  DEVELOPER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasRole(session: SessionContext, minimum: string): boolean {
  return (ROLE_RANK[session.role] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}
