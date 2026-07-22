import Link from "next/link";
import { prisma } from "@aitg/database";
import { Card, Table, Th, Td, GateBadge, EmptyState } from "@aitg/ui";
import { SEVERITY_LABEL, SEVERITY_COLOR, type RunSeverity } from "@aitg/shared";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";
import { relativeTime, shortSha } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const session = await requireSession();

  const runs = await prisma.testRun.findMany({
    where: scoped(session),
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      createdAt: true,
      branch: true,
      commitSha: true,
      trigger: true,
      severity: true,
      mutationScore: true,
      mutantsSurvived: true,
      mutantsTotal: true,
      repository: { select: { fullName: true } },
      qualityGateResult: { select: { status: true } },
    },
  });

  return (
    <>
      <PageHeader title="Runs" description="Every mutation scan uploaded from the CLI or CI." />

      {runs.length === 0 ? (
        <EmptyState
          title="No runs yet"
          description="Run aitg scan in a linked repository. Results appear here the moment the scan finishes."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th>Branch</Th>
                <Th>Commit</Th>
                <Th>Trigger</Th>
                <Th align="right">Score</Th>
                <Th align="right">Survived</Th>
                <Th align="right">Mutants</Th>
                <Th>Gate</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <Td>
                    <Link href={`/app/runs/${run.id}`} style={{ color: "var(--text)" }}>
                      {run.repository.fullName}
                    </Link>
                  </Td>
                  <Td mono>{run.branch ?? "—"}</Td>
                  <Td mono>{shortSha(run.commitSha)}</Td>
                  <Td mono>{run.trigger}</Td>
                  <Td align="right" mono>
                    {/* A broken scan has no score. Showing 0% would read as
                        "terrible tests" instead of "this never ran". */}
                    {run.severity === "P0_SCAN_BROKEN" ? (
                      <span style={{ color: "var(--text-faint)" }}>—</span>
                    ) : (
                      `${(run.mutationScore ?? 0).toFixed(1)}%`
                    )}
                  </Td>
                  <Td align="right" mono>
                    <span style={{ color: (run.mutantsSurvived ?? 0) > 0 ? "var(--survived)" : undefined }}>
                      {run.mutantsSurvived ?? 0}
                    </span>
                  </Td>
                  <Td align="right" mono>{run.mutantsTotal ?? 0}</Td>
                  <Td>
                    {run.severity === "P0_SCAN_BROKEN" ? (
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          letterSpacing: "0.06em",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-sm)",
                          color: "var(--fail)",
                          border: "1px solid var(--fail)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        SCAN BROKEN
                      </span>
                    ) : run.qualityGateResult ? (
                      <GateBadge status={run.qualityGateResult.status} />
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>—</span>
                    )}
                  </Td>
                  <Td align="right" mono>{relativeTime(run.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
