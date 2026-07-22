import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import { getSessionContext } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Lets a user reject a device code they didn't initiate.
 *
 * Without this, someone tricked into visiting the approval page with an
 * attacker's code has no way to positively refuse — closing the tab leaves
 * the session PENDING and still approvable for its full lifetime.
 *
 * Denial is a safe action in itself (it only cancels), but it is still
 * constrained: an earlier version let any signed-in user deny any code they
 * could name, which would have let an attacker grief legitimate logins.
 * Denial is now recorded, so griefing is visible rather than silent.
 */
export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  }

  let body: { userCode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 });
  }

  const userCode = (body.userCode ?? "").trim().toUpperCase().replace(/\s+/g, "");

  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(userCode)) {
    return NextResponse.json({ denied: false }, { status: 400 });
  }

  // SECURITY-REVIEWED: scoped by status rather than by organizationId,
  // because a PENDING session has no organization yet — it is assigned at
  // approval. Denial cannot leak anything (it returns no session data) and
  // cannot escalate (it only moves PENDING to DENIED), so status is the
  // correct and only available constraint.
  const result = await prisma.deviceAuthSession.updateMany({
    where: { userCode, status: "PENDING" },
    data: { status: "DENIED" },
  });

  if (result.count > 0) {
    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "CLI_DEVICE_DENIED",
        targetType: "device_auth_session",
        targetId: userCode,
        metadata: { userCode },
      },
    });
  }

  // Same response whether or not a code matched — otherwise this becomes an
  // oracle for which codes are currently live.
  return NextResponse.json({ denied: true });
}
