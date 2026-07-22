import { prisma } from "@aitg/database";
import { handleRoute, ok, fail } from "../../../lib/http";

export const dynamic = "force-dynamic";

/**
 * Liveness + readiness in one. Returns 503 (not 500) when a dependency is
 * down so orchestrators treat it as "not ready to serve" rather than
 * "crashed and needs restarting".
 */
export const GET = handleRoute(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return fail("Database unreachable.", 503, "DEPENDENCY_UNAVAILABLE");
  }

  return ok({ status: "ok", timestamp: new Date().toISOString() });
});
