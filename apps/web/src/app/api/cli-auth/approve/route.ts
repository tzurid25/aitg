import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import { getSessionContext } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Approves a pending `aitg login` from the browser.
 *
 * This closes the loop the CLI has been waiting on: the CLI created a
 * DeviceAuthSession and is polling the API, but nothing could move it out of
 * PENDING until a human proved who they were. That proof is this route's
 * session cookie.
 *
 * Note what this does NOT do: mint the API key. The key is issued by the API
 * on the CLI's next poll, so the plaintext secret only ever travels over the
 * CLI's own HTTPS response — never through a browser, a page render, or this
 * session.
 */
export async function POST(request: Request) {
  const session = await getSessionContext();

  if (!session) {
    return NextResponse.json(
      { message: "Sign in to approve a device.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  let body: { userCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { message: "Request body must be valid JSON.", code: "VALIDATION_ERROR" },
      { status: 400 },
    );
  }

  // Codes are displayed uppercase with a hyphen; accept whatever casing and
  // spacing the user typed rather than failing on a cosmetic mismatch.
  const userCode = (body.userCode ?? "").trim().toUpperCase().replace(/\s+/g, "");

  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode)) {
    return NextResponse.json(
      {
        message: "That doesn't look like a device code.",
        hint: "Codes look like ABCD-EFGH. Check the code shown in your terminal.",
        code: "INVALID_CODE_FORMAT",
      },
      { status: 400 },
    );
  }

  // Bounds code guessing. The code space is large (31^8), but a limit turns
  // "infeasible" into "impossible" and caps the damage of a phishing run.
  const recentApprovals = await prisma.auditLog.count({
    where: {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "CLI_DEVICE_APPROVED",
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });

  if (recentApprovals >= 10) {
    return NextResponse.json(
      {
        message: "Too many device authorizations in the last hour.",
        hint: "If you did not start these logins, revoke your API keys and contact your organization owner.",
        code: "RATE_LIMITED",
      },
      { status: 429 },
    );
  }

  const deviceSession = await prisma.deviceAuthSession.findUnique({
    where: { userCode },
  });

  if (!deviceSession || deviceSession.expiresAt < new Date()) {
    return NextResponse.json(
      {
        message: "This code has expired or doesn't exist.",
        hint: "Run `aitg login` again to get a fresh code.",
        code: "CODE_EXPIRED",
      },
      { status: 404 },
    );
  }

  if (deviceSession.status !== "PENDING") {
    return NextResponse.json(
      {
        message: "This code has already been used.",
        hint: "Run `aitg login` again if you need to authorize another machine.",
        code: "CODE_ALREADY_USED",
      },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.deviceAuthSession.update({
      where: { id: deviceSession.id },
      data: {
        status: "APPROVED",
        approvedByUserId: session.userId,
        organizationId: session.organizationId,
      },
    }),
    // Audited because device-code flows are phishable: an attacker can start
    // a login on their own machine and talk a victim into approving the code.
    // Nothing in the protocol distinguishes that from a legitimate approval,
    // so the durable defence is an owner-visible record of every device that
    // was ever authorised, and by whom.
    prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "CLI_DEVICE_APPROVED",
        targetType: "device_auth_session",
        targetId: deviceSession.id,
        metadata: {
          userCode,
          approvedAt: new Date().toISOString(),
        },
      },
    }),
  ]);

  return NextResponse.json({
    approved: true,
    organizationSlug: session.organizationSlug,
  });
}
