import { prisma } from "@aitg/database";
import { Card, Table, Th, Td } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";
import { relativeTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

const ROLE_DESCRIPTION: Record<string, string> = {
  OWNER: "Full control, including billing and deletion",
  ADMIN: "Manage projects, gates, keys, and members",
  DEVELOPER: "Run scans and view all results",
  VIEWER: "Read-only access to results",
};

export default async function TeamPage() {
  const session = await requireSession();

  const members = await prisma.membership.findMany({
    where: scoped(session),
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      acceptedAt: true,
      invitedEmail: true,
      user: { select: { email: true, name: true, lastLoginAt: true } },
    },
  });

  return (
    <>
      <PageHeader title="Team" description={`${members.length} member${members.length === 1 ? "" : "s"} in ${session.organizationName}.`} />

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Permissions</Th>
              <Th align="right">Last active</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <Td>
                  <div>{member.user.name ?? member.user.email}</div>
                  {member.user.name && (
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{member.user.email}</div>
                  )}
                </Td>
                <Td mono>{member.role}</Td>
                <Td>
                  <span style={{ color: "var(--text-muted)", fontSize: 12.5 }}>
                    {ROLE_DESCRIPTION[member.role] ?? ""}
                  </span>
                </Td>
                <Td align="right" mono>
                  {member.user.lastLoginAt ? relativeTime(member.user.lastLoginAt) : "never"}
                </Td>
                <Td>{member.acceptedAt ? "Active" : "Invited"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
