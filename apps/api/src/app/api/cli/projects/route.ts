import { prisma } from "@aitg/database";
import type { Project } from "@aitg/shared";
import { z } from "zod";
import { authenticateRequest, requireRole, scopedWhere } from "../../../../lib/auth";
import { handleRoute, ok, parseBody } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export const GET = handleRoute(async (request) => {
  const auth = await authenticateRequest(request);

  const projects = await prisma.project.findMany({
    where: scopedWhere(auth),
    select: { id: true, slug: true, name: true },
    orderBy: { createdAt: "asc" },
  });

  return ok<Project[]>(projects);
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Slug may contain lowercase letters, numbers, and hyphens only."),
  description: z.string().max(500).optional(),
  minMutationScore: z.number().min(0).max(100).default(70),
});

/**
 * Creates a project together with its default quality gate, in one
 * transaction.
 *
 * The gate is not optional. A project without one silently accepts every
 * scan regardless of score — uploads would never produce a
 * QualityGateResult, the dashboard verdict column would stay empty, and the
 * product's entire premise would be inert until someone noticed.
 */
export const POST = handleRoute(async (request) => {
  const auth = await authenticateRequest(request);
  await requireRole(auth, "ADMIN");

  const body = await parseBody(request, createProjectSchema);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        organizationId: auth.organizationId,
        name: body.name,
        slug: body.slug,
        description: body.description,
      },
      select: { id: true, slug: true, name: true },
    });

    await tx.qualityGate.create({
      data: {
        organizationId: auth.organizationId,
        projectId: created.id,
        name: "Default Quality Gate",
        minMutationScore: body.minMutationScore,
        failBuildOnBreach: true,
        isActive: true,
        excludePatterns: ["**/*.test.*", "**/*.spec.*", "**/migrations/**"],
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId: auth.organizationId,
        actorUserId: auth.userId,
        action: "PROJECT_CREATED",
        targetType: "project",
        targetId: created.id,
        metadata: { slug: created.slug, minMutationScore: body.minMutationScore },
      },
    });

    return created;
  });

  return ok<Project>(project, 201);
});
