import { prisma } from "@aitg/database";
import { Card, Table, Th, Td, EmptyState } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await requireSession();

  const projects = await prisma.project.findMany({
    where: scoped(session),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: { select: { repositories: true } },
      qualityGates: { where: { isActive: true }, take: 1, select: { minMutationScore: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Projects"
        description="A project groups repositories that share a quality gate."
      />

      {projects.length === 0 ? (
        <EmptyState
          title="No projects"
          description="Create a project to group your repositories and set a shared mutation-score threshold."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th align="right">Repositories</Th>
                <Th align="right">Gate threshold</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <Td>{project.name}</Td>
                  <Td mono>{project.slug}</Td>
                  <Td align="right" mono>{project._count.repositories}</Td>
                  <Td align="right" mono>
                    {project.qualityGates[0] ? `${project.qualityGates[0].minMutationScore}%` : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
