import { prisma } from "@aitg/database";
import { Card, Table, Th, Td, EmptyState } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";

export const dynamic = "force-dynamic";

export default async function GatesPage() {
  const session = await requireSession();

  const gates = await prisma.qualityGate.findMany({
    where: scoped(session),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      minMutationScore: true,
      maxSurvivedMutants: true,
      failBuildOnBreach: true,
      isActive: true,
      project: { select: { name: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="Quality gates"
        description="A gate decides whether a scan blocks the build. The CLI exits non-zero when a gate fails."
      />

      {gates.length === 0 ? (
        <EmptyState
          title="No quality gates"
          description="Every project gets a default gate at 70% mutation score. Create a project to see one here."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Project</Th>
                <Th>Gate</Th>
                <Th align="right">Min score</Th>
                <Th align="right">Max survivors</Th>
                <Th>On breach</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {gates.map((gate) => (
                <tr key={gate.id}>
                  <Td>{gate.project.name}</Td>
                  <Td>{gate.name}</Td>
                  <Td align="right" mono>{gate.minMutationScore}%</Td>
                  <Td align="right" mono>{gate.maxSurvivedMutants ?? "—"}</Td>
                  <Td>{gate.failBuildOnBreach ? "Fail the build" : "Warn only"}</Td>
                  <Td>{gate.isActive ? "Active" : "Disabled"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
