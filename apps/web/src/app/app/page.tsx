import Link from "next/link";
import { prisma, MutantStatus } from "@aitg/database";
import { Card, SectionLabel, GateBadge, EmptyState, Table, Th, Td } from "@aitg/ui";
import { requireSession, scoped } from "../../lib/session";
import { PageHeader } from "../../components/AppShell";
import { ScoreTrend } from "../../components/ScoreTrend";
import { relativeTime } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const session = await requireSession();

  const [runs, repoCount, survivorHotspots] = await Promise.all([
    prisma.testRun.findMany({
      where: scoped(session),
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        createdAt: true,
        branch: true,
        commitSha: true,
        mutationScore: true,
        mutantsSurvived: true,
        mutantsTotal: true,
        repository: { select: { fullName: true } },
        qualityGateResult: { select: { status: true } },
      },
    }),
    prisma.repository.count({ where: scoped(session, { isActive: true }) }),
    // Which files keep producing survivors. This is the question a lead
    // actually asks — "where is our testing weakest" — and it isn't
    // answerable from any single run.
    prisma.mutant.groupBy({
      by: ["filePath"],
      where: scoped(session, { status: MutantStatus.SURVIVED }),
      _count: { _all: true },
      orderBy: { _count: { filePath: "desc" } },
      take: 5,
    }),
  ]);

  if (runs.length === 0) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState
          title="No scans yet"
          description="Run aitg scan in a linked repository and results will appear here within seconds."
          action={
            <Link href="/app/keys" className="mono" style={{ color: "var(--accent)", fontSize: 13 }}>
              Get started →
            </Link>
          }
        />
      </>
    );
  }

  const latest = runs[0];
  const chronological = [...runs].reverse();
  const avgScore =
    runs.reduce((sum, r) => sum + (r.mutationScore ?? 0), 0) / runs.length;
  const totalSurvivors = runs.reduce((sum, r) => sum + (r.mutantsSurvived ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${repoCount} active ${repoCount === 1 ? "repository" : "repositories"}`}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 20,
        }}
      >
        <Metric
          label="Latest score"
          value={`${(latest?.mutationScore ?? 0).toFixed(1)}%`}
          tone={latest?.qualityGateResult?.status === "FAILED" ? "fail" : "pass"}
        />
        <Metric label="Average, last 30" value={`${avgScore.toFixed(1)}%`} />
        <Metric label="Survivors, last 30" value={totalSurvivors.toLocaleString()} tone="warn" />
        <Metric label="Runs recorded" value={runs.length.toString()} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Card>
          <SectionLabel>Mutation score over time</SectionLabel>
          <ScoreTrend
            points={chronological.map((r) => ({
              label: new Date(r.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              }),
              score: r.mutationScore ?? 0,
            }))}
          />
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <Card padded={false}>
          <div style={{ padding: "16px 20px 0" }}>
            <SectionLabel>Recent runs</SectionLabel>
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Repository</Th>
                <Th>Branch</Th>
                <Th align="right">Score</Th>
                <Th align="right">Survived</Th>
                <Th>Gate</Th>
                <Th align="right">When</Th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 8).map((run) => (
                <tr key={run.id}>
                  <Td>
                    <Link href={`/app/runs/${run.id}`} style={{ color: "var(--text)" }}>
                      {run.repository.fullName}
                    </Link>
                  </Td>
                  <Td mono>{run.branch ?? "—"}</Td>
                  <Td align="right" mono>
                    {(run.mutationScore ?? 0).toFixed(1)}%
                  </Td>
                  <Td align="right" mono>
                    <span style={{ color: (run.mutantsSurvived ?? 0) > 0 ? "var(--survived)" : undefined }}>
                      {run.mutantsSurvived ?? 0}
                    </span>
                  </Td>
                  <Td>
                    {run.qualityGateResult ? (
                      <GateBadge status={run.qualityGateResult.status} />
                    ) : (
                      <span style={{ color: "var(--text-faint)" }}>—</span>
                    )}
                  </Td>
                  <Td align="right" mono>
                    {relativeTime(run.createdAt)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <SectionLabel>Weakest tested files</SectionLabel>
          {survivorHotspots.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              No surviving mutants recorded. Your tests are catching everything.
            </div>
          ) : (
            <div>
              {survivorHotspots.map((spot) => (
                <div
                  key={spot.filePath}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      direction: "rtl",
                      textAlign: "left",
                    }}
                    title={spot.filePath}
                  >
                    {spot.filePath}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 12, color: "var(--survived)", flexShrink: 0 }}
                  >
                    {spot._count._all}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pass" | "warn" | "fail";
}) {
  const color =
    tone === "pass"
      ? "var(--pass)"
      : tone === "warn"
        ? "var(--survived)"
        : tone === "fail"
          ? "var(--fail)"
          : "var(--text)";

  return (
    <Card>
      <div className="label">{label}</div>
      <div
        className="mono"
        style={{ fontSize: 25, fontWeight: 600, color, marginTop: 6, letterSpacing: "-0.02em" }}
      >
        {value}
      </div>
    </Card>
  );
}
