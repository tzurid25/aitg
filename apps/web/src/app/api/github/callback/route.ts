import { NextResponse } from "next/server";
import { prisma } from "@aitg/database";
import { getSessionContext } from "../../../../lib/session";

export const dynamic = "force-dynamic";

/**
 * Post-installation binding for the GitHub App.
 *
 * SECURITY: installation_id arrives in a URL the caller controls, and GitHub
 * issues these ids sequentially — so it must never be trusted on its own. An
 * earlier version of this route bound whatever id showed up to the caller's
 * organization. That meant anyone with a free account could guess a victim's
 * installation id, hit this endpoint, and silently take over their
 * repositories, including write access to Actions secrets.
 *
 * Three checks close it:
 *
 *   1. Exchange GitHub's one-time `code` for a user token. Only the person
 *      GitHub just redirected can produce a valid code.
 *   2. Ask GitHub, as that user, which installations they administer. The id
 *      must appear in their own list — GitHub only returns installations on
 *      accounts where the user holds admin rights, so presence in that list
 *      is the entitlement proof.
 *   3. Refuse to re-bind an installation already owned by a different
 *      organization.
 *
 * The webhook cannot do this job: it knows the GitHub account but not which
 * AITG organization it belongs to. Only the browser session carries that.
 */

interface UserInstallation {
  id: number;
  account: { login: string; type: string } | null;
}

async function exchangeCodeForUserToken(code: string): Promise<string | null> {
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as { access_token?: string };
  return data.access_token ?? null;
}

async function listUserInstallations(userToken: string): Promise<UserInstallation[]> {
  const response = await fetch("https://api.github.com/user/installations?per_page=100", {
    headers: {
      Authorization: `Bearer ${userToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!response.ok) return [];
  const data = (await response.json()) as { installations?: UserInstallation[] };
  return data.installations ?? [];
}

function fail(origin: string, reason: string) {
  return NextResponse.redirect(new URL(`/app/integrations?error=${reason}`, origin));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await getSessionContext();
  const installationId = url.searchParams.get("installation_id");
  const code = url.searchParams.get("code");

  if (!session) {
    const callback = encodeURIComponent(url.pathname + url.search);
    return NextResponse.redirect(new URL(`/login?callbackUrl=${callback}`, url.origin));
  }

  if (!installationId) return fail(url.origin, "missing_installation");

  // Without a code there is no way to prove the caller owns this
  // installation. Refuse rather than bind on trust.
  if (!code) return fail(url.origin, "missing_code");

  const userToken = await exchangeCodeForUserToken(code);
  if (!userToken) return fail(url.origin, "code_exchange_failed");

  const installations = await listUserInstallations(userToken);
  const match = installations.find((install) => String(install.id) === installationId);

  if (!match) {
    // This is the branch that stops the takeover.
    console.warn(
      `[github] rejected binding: user ${session.userId} does not control installation ${installationId}`,
    );
    return fail(url.origin, "not_authorized");
  }

  const existing = await prisma.githubInstallation.findUnique({
    where: { installationId },
    select: { organizationId: true },
  });

  if (existing && existing.organizationId !== session.organizationId) {
    return fail(url.origin, "already_linked");
  }

  await prisma.githubInstallation.upsert({
    where: { installationId },
    create: {
      installationId,
      organizationId: session.organizationId,
      // From GitHub's own response, not from a URL parameter.
      accountLogin: match.account?.login ?? "unknown",
      accountType: match.account?.type ?? "Organization",
    },
    update: {
      accountLogin: match.account?.login ?? "unknown",
      accountType: match.account?.type ?? "Organization",
      uninstalledAt: null,
      suspendedAt: null,
    },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      action: "GITHUB_APP_INSTALLED",
      targetType: "github_installation",
      targetId: installationId,
      metadata: { installationId, accountLogin: match.account?.login ?? null, verified: true },
    },
  });

  return NextResponse.redirect(new URL("/app/integrations?installed=1", url.origin));
}
