import { prisma } from "@aitg/database";
import {
  linkRepositoryRequestSchema,
  type LinkRepositoryResponse,
} from "@aitg/shared";
import { ApiAuthError, authenticateRequest, scopedWhere } from "../../../../../lib/auth";
import { handleRoute, ok, parseBody } from "../../../../../lib/http";

export const dynamic = "force-dynamic";

/**
 * Idempotent by design: `aitg scan` calls this on every run so that a repo
 * linked on one machine is immediately usable from another (or from CI)
 * without a separate setup step. Re-linking an existing repo updates its
 * default branch and returns the same id rather than erroring.
 */
export const POST = handleRoute(async (request) => {
  const auth = await authenticateRequest(request);
  const body = await parseBody(request, linkRepositoryRequestSchema);

  // Scoped lookup: a project slug from another tenant must not resolve.
  const project = await prisma.project.findFirst({
    where: scopedWhere(auth, { slug: body.projectSlug }),
    select: { id: true, slug: true, name: true },
  });

  if (!project) {
    throw new ApiAuthError(
      `No project "${body.projectSlug}" in this organization.`,
      404,
      "PROJECT_NOT_FOUND",
    );
  }

  const repository = await prisma.repository.upsert({
    where: {
      projectId_fullName: { projectId: project.id, fullName: body.fullName },
    },
    create: {
      organizationId: auth.organizationId,
      projectId: project.id,
      fullName: body.fullName,
      defaultBranch: body.defaultBranch,
      provider: body.provider,
      isActive: true,
    },
    update: {
      defaultBranch: body.defaultBranch,
      provider: body.provider,
      isActive: true,
    },
    select: { id: true },
  });

  return ok<LinkRepositoryResponse>({
    repositoryId: repository.id,
    project,
  });
});
