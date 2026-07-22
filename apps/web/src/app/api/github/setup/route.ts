import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import crypto from "node:crypto";
import { getSessionContext, scoped, hasRole } from "../../../../lib/session";
import { setupRepositoryWorkflow } from "../../../../lib/github-proxy";

export const dynamic = "force-dynamic";

/**
 * One-click connect: mints a scan key, writes it to the repository's Actions
 * secrets, and opens a pull request adding the workflow.
 *
 * The key is created here rather than reused so it can be scoped and revoked
 * per repository — a leaked CI key should not take down every other repo.
 */
export async function POST(request: Request) {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  }

  if (!hasRole(session, "ADMIN")) {
    return NextResponse.json(
      {
        message: "Only admins can connect repositories.",
        hint: "Ask an organization owner or admin to run this setup.",
      },
      { status: 403 },
    );
  }

  let body: { fullName?: string; installationId?: string; projectSlug?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Invalid request." }, { status: 400 });
  }

  const { fullName, installationId } = body;
  if (!fullName || !installationId) {
    return NextResponse.json(
      { message: "A repository and installation are required." },
      { status: 400 },
    );
  }

  // Scoped: an installationId from another tenant must not resolve.
  const installation = await prisma.githubInstallation.findFirst({
    where: scoped(session, { installationId, uninstalledAt: null }),
    select: { id: true },
  });

  if (!installation) {
    return NextResponse.json(
      { message: "That GitHub installation is not connected to this organization." },
      { status: 404 },
    );
  }

  // A project to attach the repository to. Reuse the first, or create one
  // named after the repo — a setup flow that stops to ask "which project?"
  // before the user has any is friction for no gain.
  let project = await prisma.project.findFirst({
    where: scoped(session),
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true },
  });

  if (!project) {
    const slug = fullName.split("/")[1]?.toLowerCase().replace(/[^a-z0-9-]/g, "-") ?? "default";
    project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          organizationId: session.organizationId,
          name: fullName.split("/")[1] ?? "Default",
          slug,
        },
        select: { id: true, slug: true },
      });
      await tx.qualityGate.create({
        data: {
          organizationId: session.organizationId,
          projectId: created.id,
          name: "Default Quality Gate",
          minMutationScore: 70,
          failBuildOnBreach: true,
          isActive: true,
          excludePatterns: ["**/*.test.*", "**/*.spec.*", "**/migrations/**"],
        },
      });
      return created;
    });
  }

  // Mint the CI key.
  const secret = crypto.randomBytes(32).toString("base64url");
  const plaintext = `aitg_live_${secret}`;
  const keyHash = crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");

  const apiKey = await prisma.apiKey.create({
    data: {
      organizationId: session.organizationId,
      createdByUserId: session.userId,
      name: `CI — ${fullName}`,
      keyPrefix: plaintext.slice(0, 16),
      keyHash,
      scope: "CLI_SCAN",
    },
    select: { id: true },
  });

  try {
    const result = await setupRepositoryWorkflow({
      installationId,
      fullName,
      apiKey: plaintext,
    });

    await prisma.repository.upsert({
      where: { projectId_fullName: { projectId: project.id, fullName } },
      create: {
        organizationId: session.organizationId,
        projectId: project.id,
        fullName,
        provider: "GITHUB",
        defaultBranch: "main",
        githubInstallationId: installationId,
        isActive: true,
      },
      update: { githubInstallationId: installationId, isActive: true },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        action: "REPOSITORY_CONNECTED",
        targetType: "repository",
        targetId: fullName,
        metadata: { fullName, apiKeyId: apiKey.id },
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    // Revoke the key we just minted. Leaving a live credential behind after a
    // failed setup is exactly the kind of orphan that turns into an incident.
    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { revokedAt: new Date() },
    });

    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        message: "Could not complete setup.",
        hint: message.includes("403")
          ? "The GitHub App may lack Contents or Secrets write permission. Check its permissions, then accept the update in GitHub."
          : message.slice(0, 300),
      },
      { status: 502 },
    );
  }
}
