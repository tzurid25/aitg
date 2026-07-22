import { prisma } from "@aitg/database";
import { Card, SectionLabel, Table, Th, Td } from "@aitg/ui";
import { requireSession, scoped } from "../../../lib/session";
import { PageHeader } from "../../../components/AppShell";

export const dynamic = "force-dynamic";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "",
    points: ["3 projects", "50 scans per month", "Local reports and fix prompts"],
  },
  {
    id: "team",
    name: "Team",
    price: "$19",
    cadence: "per user / month",
    points: [
      "Unlimited scans",
      "Full cloud dashboard and trends",
      "Quality gates in CI",
      "Slack and Discord notifications",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    points: ["GitHub App integration", "SSO", "Audit logs and compliance reports", "Priority support"],
  },
];

export default async function BillingPage() {
  const session = await requireSession();

  const [org, invoices] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: session.organizationId },
      select: {
        planId: true,
        billingEmail: true,
        monthlyMutationQuota: true,
        monthlyMutationsUsed: true,
        quotaResetAt: true,
      },
    }),
    prisma.billingInvoice.findMany({
      where: scoped(session),
      orderBy: { createdAt: "desc" },
      take: 12,
      select: {
        id: true,
        status: true,
        amountDueCents: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        paidAt: true,
      },
    }),
  ]);

  const currentPlan = org.planId ?? "free";
  const resetsAt = new Date(org.quotaResetAt);
  resetsAt.setMonth(resetsAt.getMonth() + 1);

  return (
    <>
      <PageHeader title="Billing" description={`Current plan: ${currentPlan}.`} />

      <div style={{ marginBottom: 20 }}>
        <Card>
          <SectionLabel>Usage this period</SectionLabel>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>
              {org.monthlyMutationsUsed.toLocaleString()}
            </span>
            <span className="mono" style={{ color: "var(--text-faint)" }}>
              / {org.monthlyMutationQuota.toLocaleString()} mutants
            </span>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
            Resets {resetsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" })}.
            Quota is measured in mutants analyzed, not scans, so a large diff costs more than a
            small one.
          </div>
        </Card>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        {PLANS.map((plan) => {
          const active = plan.id === currentPlan;
          return (
            <Card
              key={plan.id}
              style={active ? { borderColor: "var(--accent)" } : undefined}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{plan.name}</div>
                {active && (
                  <span className="label" style={{ color: "var(--accent)" }}>
                    current
                  </span>
                )}
              </div>
              <div style={{ marginTop: 8, marginBottom: 12 }}>
                <span className="mono" style={{ fontSize: 22, fontWeight: 600 }}>
                  {plan.price}
                </span>
                {plan.cadence && (
                  <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: 6 }}>
                    {plan.cadence}
                  </span>
                )}
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8 }}>
                {plan.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>

      <Card padded={false}>
        <div style={{ padding: "16px 20px 0" }}>
          <SectionLabel>Invoices</SectionLabel>
        </div>
        {invoices.length === 0 ? (
          <div style={{ padding: "0 20px 20px", fontSize: 13, color: "var(--text-muted)" }}>
            No invoices yet. The free plan doesn&apos;t generate any.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Period</Th>
                <Th>Status</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Paid</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <Td mono>
                    {invoice.periodStart?.toLocaleDateString("en-US") ?? "-"} –{" "}
                    {invoice.periodEnd?.toLocaleDateString("en-US") ?? "-"}
                  </Td>
                  <Td>{invoice.status}</Td>
                  <Td align="right" mono>
                    {(invoice.amountDueCents / 100).toFixed(2)} {invoice.currency.toUpperCase()}
                  </Td>
                  <Td align="right" mono>
                    {invoice.paidAt?.toLocaleDateString("en-US") ?? "-"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
