import { prisma } from "@aitg/database";
import { Card, SectionLabel } from "@aitg/ui";
import { requireSession } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { name: true, slug: true, billingEmail: true, createdAt: true },
  });

  return (
    <>
      <PageHeader title="Settings" />

      <div style={{ display: "grid", gap: 16, maxWidth: 620 }}>
        <Card>
          <SectionLabel>Organization</SectionLabel>
          <Field label="Name" value={org.name} />
          <Field label="Slug" value={org.slug} mono />
          <Field label="Billing email" value={org.billingEmail ?? "—"} />
          <Field label="Created" value={org.createdAt.toLocaleDateString()} />
        </Card>

        <Card>
          <SectionLabel>Your account</SectionLabel>
          <Field label="Email" value={session.email} />
          <Field label="Role" value={session.role} mono />
        </Card>

        <Card>
          <SectionLabel>AI fix prompts</SectionLabel>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.7 }}>
            Fix prompts are generated locally and cost nothing. If you want the dashboard to
            generate suggested test code directly, add your own Anthropic or OpenAI key — requests
            run on your account, so there is no markup and no usage cap from us.
          </p>
          <div
            style={{
              padding: "10px 12px",
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12.5,
              color: "var(--text-faint)",
            }}
          >
            Bring-your-own-key configuration is not available yet.
          </div>
        </Card>
      </div>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "9px 0",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
      <span className={mono ? "mono" : undefined} style={{ fontSize: 13 }}>
        {value}
      </span>
    </div>
  );
}
