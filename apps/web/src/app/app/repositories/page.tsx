import { prisma } from "@aitg/database";
import { Card, Table, Th, Td, EmptyState } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";
import { relativeTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function RepositoriesPage() {
  const session = await requireSession();

  const repositories = await prisma.repository.findMany({
    where: scoped(session),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      fullName: true,
      provider: true,
      defaultBranch: true,
      isActive: true,
      project: { select: { name: true } },
      testRuns: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true, mutationScore: true },
      },
    },
  });

  return (
    <>
      <PageHeader title="Repositories" description="Repositories reporting mutation results." />

      {repositories.length === 0 ? (
        <EmptyState
          title="No repositories linked"
          description="Run aitg init inside a repository to link it. Linking is idempotent, so CI can run it too."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th>Project</Th>
                <Th>Provider</Th>
                <Th>Default branch</Th>
                <Th align="right">Last score</Th>
                <Th align="right">Last scan</Th>
              </tr>
            </thead>
            <tbody>
              {repositories.map((repo) => {
                const last = repo.testRuns[0];
                return (
                  <tr key={repo.id}>
                    <Td mono>{repo.fullName}</Td>
                    <Td>{repo.project.name}</Td>
                    <Td mono>{repo.provider}</Td>
                    <Td mono>{repo.defaultBranch}</Td>
                    <Td align="right" mono>
                      {last?.mutationScore != null ? `${last.mutationScore.toFixed(1)}%` : "—"}
                    </Td>
                    <Td align="right" mono>
                      {last ? relativeTime(last.createdAt) : "never"}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
