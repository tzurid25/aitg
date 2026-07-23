import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import { verifyWebhookSignature, isGithubConfigured } from "@/lib/github/client";
import { openPendingCheck } from "@/lib/github/checks";

export const dynamic = "force-dynamic";

/**
 * GitHub webhook receiver.
 *
 * Reads the RAW body, not the parsed JSON. The HMAC is computed over the exact
 * bytes GitHub sent; re-serializing a parsed object changes whitespace and key
 * order, and the signature would never match again.
 *
 * Every event is recorded to WebhookEvent before any work happens, so a
 * delivery that crashes mid-processing can be replayed rather than lost.
 * GitHub retries on non-2xx, so anything we've already stored returns 200 to
 * avoid duplicate side effects.
 */
export async function POST(request: Request) {
  if (!isGithubConfigured()) {
    return NextResponse.json(
      { message: "GitHub integration is not configured on this server." },
      { status: 503 },
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyWebhookSignature(rawBody, signature)) {
    // No detail in the response. A rejected delivery should tell an attacker
    // nothing about why.
    return NextResponse.json({ message: "Invalid signature." }, { status: 401 });
  }

  // SECURITY-REVIEWED: the payload is attacker-shaped but not attacker-
  // authored — the HMAC above proves GitHub sent these exact bytes. The
  // installation id inside is then resolved through a database lookup that
  // determines the tenant, rather than the payload asserting one.
  const eventType = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery") ?? crypto.randomUUID();

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "Malformed payload." }, { status: 400 });
  }

  const installationId = extractInstallationId(payload);

  // Resolve the owning organization before recording, so the event row is
  // tenant-scoped like everything else.
  const installation = installationId
    ? await prisma.githubInstallation.findUnique({
        where: { installationId },
        select: { organizationId: true, uninstalledAt: true },
      })
    : null;

  // Deduplicate on GitHub's delivery id. Retries are normal and must not
  // produce a second check run.
  const existing = await prisma.webhookEvent.findFirst({
    where: { source: "github", externalId: deliveryId },
    select: { id: true },
  });

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const event = await prisma.webhookEvent.create({
    data: {
      organizationId: installation?.organizationId ?? null,
      source: "github",
      externalId: deliveryId,
      eventType,
      payload: payload as object,
      status: "PENDING",
    },
    select: { id: true },
  });

  try {
    await handleEvent({ eventType, payload, installationId, installation });

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
  } catch (err) {
    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        status: "FAILED",
        // The model's field is `errorMessage`; writing `error` threw here,
        // inside the handler whose whole job is recording the failure.
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });

    // Still 200. GitHub's retry would hit the dedup check above and change
    // nothing; the stored row is what lets us investigate and replay.
    console.error(`[webhook] ${eventType} (${deliveryId}) failed:`, err);
  }

  return NextResponse.json({ received: true });
}

function extractInstallationId(payload: Record<string, unknown>): string | null {
  const installation = payload.installation as { id?: number } | undefined;
  return installation?.id ? String(installation.id) : null;
}

async function handleEvent(params: {
  eventType: string;
  payload: Record<string, unknown>;
  installationId: string | null;
  installation: { organizationId: string; uninstalledAt: Date | null } | null;
}): Promise<void> {
  const { eventType, payload, installationId, installation } = params;

  switch (eventType) {
    case "installation":
      await handleInstallation(payload, installationId);
      return;

    case "pull_request": {
      const action = payload.action as string;
      // Only these three change the head commit. Ignoring the rest (labeled,
      // assigned, review_requested…) keeps us from re-checking a commit that
      // hasn't moved.
      if (!["opened", "reopened", "synchronize"].includes(action)) return;

      if (!installationId || !installation || installation.uninstalledAt) return;

      const pr = payload.pull_request as {
        number: number;
        head: { sha: string };
      };
      const repo = payload.repository as { full_name: string };

      await openPendingCheck({
        installationId,
        fullName: repo.full_name,
        headSha: pr.head.sha,
      });
      return;
    }

    default:
      // Unhandled events are still recorded, which is the point — the stored
      // payload is how we learn what we actually receive in production.
      return;
  }
}

async function handleInstallation(
  payload: Record<string, unknown>,
  installationId: string | null,
): Promise<void> {
  if (!installationId) return;

  const action = payload.action as string;

  if (action === "deleted") {
    // Marked, not deleted. Historical test runs still reference this
    // installation, and losing the row would orphan them.
    await prisma.githubInstallation.updateMany({
      where: { installationId },
      data: { uninstalledAt: new Date() },
    });
    return;
  }

  if (action === "suspend") {
    await prisma.githubInstallation.updateMany({
      where: { installationId },
      data: { suspendedAt: new Date() },
    });
    return;
  }

  if (action === "unsuspend") {
    await prisma.githubInstallation.updateMany({
      where: { installationId },
      data: { suspendedAt: null },
    });
  }

  // "created" is handled by the post-install redirect in the dashboard, not
  // here. The webhook has no idea which AITG organization the installer
  // belongs to — only their authenticated browser session does.
}
