import { prisma } from "@aitg/database";
import type { DeviceAuthStartResponse } from "@aitg/shared";
import { generateDeviceCode, generateUserCode } from "@/lib/api-keys";
import { handleRoute, ok } from "@/lib/http";
import { enforceRateLimit, ipKey, RATE_LIMITS } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const EXPIRY_SECONDS = 600; // 10 minutes
const POLL_INTERVAL_SECONDS = 3;

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "https://app.aitg.dev";

/**
 * Starts an OAuth 2.0 Device Authorization Grant style flow.
 *
 * The CLI receives a secret `deviceCode` (which it polls with) and a short
 * `userCode` (which the human types into the browser). Splitting them means
 * the value shown on screen and read aloud is never sufficient on its own to
 * complete the login — approval still requires an authenticated session.
 */
export const POST = handleRoute(async (request) => {
  // Unauthenticated by nature, so limited per IP. Without this, anyone can
  // fill the device_auth_sessions table at will.
  await enforceRateLimit(
    ipKey(request, "device-auth"),
    RATE_LIMITS.deviceAuth,
    "login attempts",
  );

  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000);

  await prisma.deviceAuthSession.create({
    data: {
      deviceCodeHash: deviceCode.hash,
      userCode,
      expiresAt,
      status: "PENDING",
    },
  });

  const response: DeviceAuthStartResponse = {
    deviceCode: deviceCode.plaintext,
    userCode,
    verificationUrl: `${DASHBOARD_URL}/cli-login`,
    expiresInSeconds: EXPIRY_SECONDS,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  };

  return ok(response);
});
