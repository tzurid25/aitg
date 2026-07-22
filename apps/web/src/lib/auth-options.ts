import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma, type AuthProvider } from "@aitg/database";

/**
 * Auth is configured WITHOUT the Prisma adapter, deliberately.
 *
 * The adapter insists on its own Account / Session / VerificationToken
 * tables, which would sit alongside — and partially duplicate — the User and
 * Membership model this product already owns. Instead we use a JWT session
 * and reconcile the user into our own tables in the `signIn` callback. The
 * schema stays the one we designed, and there's no session table to prune.
 *
 * The JWT carries organizationId so that every page render can scope its
 * queries without an extra membership lookup.
 */

/**
 * Turns an email or OAuth profile name into a URL-safe org slug, then
 * de-duplicates it. Slugs are user-visible in URLs, so collisions must be
 * resolved rather than erroring the signup.
 */
async function uniqueOrgSlug(base: string): Promise<string> {
  const root =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "org";

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const existing = await prisma.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }

  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Finds or provisions the user, and guarantees they belong to at least one
 * organization. A user with no org would land on a dashboard with nothing to
 * show and no way to create anything, so first sign-in always yields an org
 * they OWN.
 */
async function reconcileUser(params: {
  email: string;
  name?: string | null;
  image?: string | null;
  provider: AuthProvider;
}): Promise<{ userId: string; organizationId: string; organizationSlug: string }> {
  const email = params.email.toLowerCase().trim();

  let user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: params.name ?? null,
        avatarUrl: params.image ?? null,
        authProvider: params.provider,
        // OAuth providers have already verified the address; trusting that
        // avoids a redundant verification email on first sign-in.
        emailVerifiedAt: params.provider === "EMAIL" ? null : new Date(),
      },
      select: { id: true },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { organization: { select: { id: true, slug: true } } },
  });

  if (membership) {
    return {
      userId: user.id,
      organizationId: membership.organization.id,
      organizationSlug: membership.organization.slug,
    };
  }

  const slug = await uniqueOrgSlug(params.name || email.split("@")[0] || "org");

  const organization = await prisma.organization.create({
    data: {
      name: params.name ? `${params.name}'s Org` : email.split("@")[0] || "My Org",
      slug,
      billingEmail: email,
      planId: "free",
      memberships: {
        create: { userId: user.id, role: "OWNER", acceptedAt: new Date() },
      },
    },
    select: { id: true, slug: true },
  });

  await prisma.auditLog.create({
    data: {
      organizationId: organization.id,
      actorUserId: user.id,
      action: "ORG_CREATED",
      targetType: "organization",
      targetId: organization.id,
      metadata: { source: "signup", provider: params.provider },
    },
  });

  return {
    userId: user.id,
    organizationId: organization.id,
    organizationSlug: organization.slug,
  };
}

const providers: NextAuthOptions["providers"] = [];

// Providers are registered conditionally so the app still boots with only
// some credentials configured — a missing GOOGLE_CLIENT_ID shouldn't crash
// local development when you're only testing GitHub.
if (process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) {
  providers.push(
    GitHubProvider({
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    }),
  );
}

if (process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  );
}

providers.push(
  CredentialsProvider({
    name: "Email",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials.password) return null;

      const user = await prisma.user.findUnique({
        where: { email: credentials.email.toLowerCase().trim() },
        select: { id: true, email: true, name: true, passwordHash: true },
      });

      // Compare against a dummy hash when the user doesn't exist so the
      // response time doesn't reveal which addresses are registered.
      const hash =
        user?.passwordHash ??
        "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

      const valid = await bcrypt.compare(credentials.password, hash);

      if (!user?.passwordHash || !valid) return null;

      return { id: user.id, email: user.email, name: user.name };
    },
  }),
);

export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user, account }) {
      if (!user.email) return false;

      const provider: AuthProvider =
        account?.provider === "github"
          ? "GITHUB"
          : account?.provider === "google"
            ? "GOOGLE"
            : "EMAIL";

      await reconcileUser({
        email: user.email,
        name: user.name,
        image: user.image,
        provider,
      });

      return true;
    },

    async jwt({ token, trigger }) {
      // Resolve org membership on first issue and on explicit update, not on
      // every request — this callback runs on every authenticated navigation.
      if (!token.organizationId || trigger === "update") {
        if (token.email) {
          const membership = await prisma.membership.findFirst({
            where: { user: { email: token.email.toLowerCase() } },
            orderBy: { createdAt: "asc" },
            select: {
              role: true,
              userId: true,
              organization: { select: { id: true, slug: true, name: true } },
            },
          });

          if (membership) {
            token.userId = membership.userId;
            token.organizationId = membership.organization.id;
            token.organizationSlug = membership.organization.slug;
            token.organizationName = membership.organization.name;
            token.role = membership.role;
          }
        }
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.userId as string,
        organizationId: token.organizationId as string,
        organizationSlug: token.organizationSlug as string,
        organizationName: token.organizationName as string,
        role: token.role as string,
      };
      return session;
    },
  },
};
