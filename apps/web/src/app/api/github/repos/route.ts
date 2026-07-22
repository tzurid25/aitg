import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import { getSessionContext, scoped } from "../../../../lib/session";
import { listInstallationRepositories } from "../../../../lib/github-proxy";

export const dynamic = "force-dynamic";

/** Repositories the org's GitHub installations can reach. */
export async function GET() {
  const session = await getSessionContext();
  if (!session) {
    return NextResponse.json({ message: "Sign in first." }, { status: 401 });
  }

  const installations = await prisma.githubInstallation.findMany({
    where: scoped(session, { uninstalledAt: null, suspendedAt: null }),
    select: { installationId: true },
  });

  const repos: Array<{ fullName: string; installationId: string; private: boolean }> = [];

  for (const install of installations) {
    try {
      const list = await listInstallationRepositories(install.installationId);
      for (const repo of list) {
        repos.push({
          fullName: repo.fullName,
          installationId: install.installationId,
          private: repo.private,
        });
      }
    } catch (err) {
      // One broken installation must not hide the others.
      console.error(`[github] listing ${install.installationId} failed:`, err);
    }
  }

  return NextResponse.json({ repositories: repos });
}
