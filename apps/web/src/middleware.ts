export { default } from "next-auth/middleware";

/**
 * Protects the dashboard and the CLI approval flow. Unauthenticated requests
 * are redirected to /login with a callbackUrl, so a user who lands on
 * /cli-login holding a device code gets back there after signing in rather
 * than being dumped on the dashboard.
 *
 * The public marketing site, /login, and NextAuth's own routes are
 * deliberately outside this matcher.
 */
export const config = {
  matcher: ["/app/:path*", "/cli-login"],
};
