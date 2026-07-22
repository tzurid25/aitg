import type { WhoamiResponse } from "@aitg/shared";
import { authenticateRequest } from "../../../../lib/auth";
import { getQuota } from "../../../../lib/quota";
import { handleRoute, ok } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const GET = handleRoute(async (request) => {
  const auth = await authenticateRequest(request);
  const quota = await getQuota(auth);

  return ok<WhoamiResponse>({
    userEmail: auth.userEmail ?? "(machine key)",
    organizationSlug: auth.organizationSlug,
    organizationId: auth.organizationId,
    quota: {
      used: quota.used,
      limit: quota.limit,
      resetsAt: quota.resetsAt.toISOString(),
    },
  });
});
