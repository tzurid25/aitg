import crypto from "node:crypto";
import { prisma } from "@aitg/database";
import { deviceAuthPollRequestSchema, type DeviceAuthPollResponse } from "@aitg/shared";
import { generateApiKey } from "@/lib/api-keys";
import { handleRoute, ok, parseBody } from "@/lib/http";
import { enforceRateLimit, ipKey, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Polled by the CLI every few seconds until the user approves in the browser.
 *
 * The API key is minted HERE, on first successful poll, rather than at
 * approval time in the browser. That way the plaintext key travels over
 * exactly one channel — the CLI's own HTTPS response — and is never rendered
 * in a browser window, logged by the dashboard, or held in a session.
 */
export const POST = handleRoute(async (request) => {
  // The CLI polls every 3s for up to 10 minutes, so the ceiling is generous.
  // Its real job is to stop someone grinding through device codes.
  await enforceRateLimit(
    ipKey(request, "device-poll"),
    RATE_LIMITS.devicePoll,
    "login polling",
  );

  // SECURITY-REVIEWED: unauthenticated by design. The device code is itself
  // the credential — 32 random bytes, single-use, 10-minute expiry, and rate
  // limited above. There is no session to scope against at this point in the
  // flow; that is the entire purpose of the endpoint. See SECURITY.md Rule 1,
  // case 3.
  const body = await parseBody(request, deviceAuthPollRequestSchema);

  const deviceCodeHash = crypto
    .createHash("sha256")
    .update(body.deviceCode, "utf8")
    .digest("hex");

  const session = await prisma.deviceAuthSession.findUnique({
    where: { deviceCodeHash },
  });

  // An unknown device code is reported as "expired" rather than 404 — a
  // polling client has no legitimate need to distinguish the two, and the
  // distinction would let someone enumerate live sessions.
  if (!session) {
    return ok<DeviceAuthPollResponse>({ status: "expired" });
  }

  if (session.expiresAt < new Date() || session.status === "EXPIRED") {
    return ok<DeviceAuthPollResponse>({ status: "expired" });
  }

  if (session.status === "DENIED") {
    return ok<DeviceAuthPollResponse>({ status: "expired" });
  }

  if (session.status === "PENDING") {
    return ok<DeviceAuthPollResponse>({ status: "pending" });
  }

  // status === APPROVED
  if (!session.organizationId || !session.approvedByUserId) {
    return ok<DeviceAuthPollResponse>({ status: "expired" });
  }

  // If a key was already issued for this session, the CLI already received
  // it. Re-issuing would leave an orphaned credential, so we treat the
  // session as spent.
  if (session.issuedApiKeyId) {
    return ok<DeviceAuthPollResponse>({ status: "expired" });
  }

  const [organization, user] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: session.organizationId },
      select: { id: true, slug: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: session.approvedByUserId },
      select: { id: true, email: true },
    }),
  ]);

  const key = generateApiKey();

  const created = await prisma.apiKey.create({
    data: {
      organizationId: organization.id,
      createdByUserId: user.id,
      name: `CLI (${new Date().toISOString().slice(0, 10)})`,
      keyPrefix: key.displayPrefix,
      keyHash: key.hash,
      scope: "CLI_SCAN",
    },
    select: { id: true },
  });

  await prisma.$transaction([
    prisma.deviceAuthSession.update({
      where: { id: session.id },
      data: { issuedApiKeyId: created.id },
    }),
    prisma.auditLog.create({
      data: {
        organizationId: organization.id,
        actorUserId: user.id,
        action: "API_KEY_CREATED",
        targetType: "api_key",
        targetId: created.id,
        metadata: { source: "cli-device-auth" },
      },
    }),
  ]);

  return ok<DeviceAuthPollResponse>({
    status: "approved",
    apiKey: key.plaintext,
    organizationId: organization.id,
    organizationSlug: organization.slug,
    userEmail: user.email,
  });
});
