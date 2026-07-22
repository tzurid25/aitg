import type { ReactNode } from "react";
import { prisma } from "@aitg/database";
import { requireSession } from "../../lib/session";
import { AppShell } from "../../components/AppShell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.organizationId },
    select: { monthlyMutationQuota: true, monthlyMutationsUsed: true },
  });

  return (
    <AppShell
      organizationName={session.organizationName}
      userEmail={session.email}
      quota={{ used: org.monthlyMutationsUsed, limit: org.monthlyMutationQuota }}
    >
      {children}
    </AppShell>
  );
}
