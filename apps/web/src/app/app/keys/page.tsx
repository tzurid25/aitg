import { prisma } from "@aitg/database";
import { Card, Table, Th, Td, EmptyState, SectionLabel } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";
import { relativeTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function KeysPage() {
  const session = await requireSession();

  const keys = await prisma.apiKey.findMany({
    where: scoped(session),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdByUser: { select: { email: true } },
    },
  });

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys authenticate the CLI. Only a prefix is stored in readable form — the secret itself is hashed and cannot be shown again."
      />

      <div style={{ marginBottom: 18 }}>
        <Card>
          <SectionLabel>Connect a machine</SectionLabel>
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 14,
              fontSize: 12.5,
              lineHeight: 1.8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              overflow: "auto",
            }}
          >{`npm install -g @aitg/cli
aitg login
aitg init
aitg scan`}</pre>
          <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-muted)" }}>
            aitg login prints a code and opens this site. Approving it here issues a key
            automatically — you never copy or paste a secret.
          </div>
        </Card>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          title="No keys yet"
          description="Run aitg login on any machine and approve the code. A key is created for you."
        />
      ) : (
        <Card padded={false}>
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Scope</Th>
                <Th>Created by</Th>
                <Th align="right">Last used</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const expired = key.expiresAt && key.expiresAt < new Date();
                const status = key.revokedAt ? "Revoked" : expired ? "Expired" : "Active";
                return (
                  <tr key={key.id}>
                    <Td>{key.name}</Td>
                    <Td mono>{key.keyPrefix}…</Td>
                    <Td mono>{key.scope}</Td>
                    <Td>{key.createdByUser?.email ?? "—"}</Td>
                    <Td align="right" mono>
                      {key.lastUsedAt ? relativeTime(key.lastUsedAt) : "never"}
                    </Td>
                    <Td>
                      <span style={{ color: status === "Active" ? "var(--killed)" : "var(--text-faint)" }}>
                        {status}
                      </span>
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
