/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"] },
  transpilePackages: ["@aitg/database", "@aitg/shared", "@aitg/ui"],

  // Security response headers. Absent these, a public deployment is
  // clickjackable and has no HSTS to prevent a downgrade. Set here rather
  // than per-route so a new route cannot forget them.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Only meaningful over HTTPS; harmless on localhost.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // frame-ancestors supersedes X-Frame-Options in modern browsers,
          // but the older header still covers clients that ignore CSP.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          // Stops a browser from treating a JSON response as HTML.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Do not leak dashboard paths (which contain run ids) to third
          // parties via the Referer header.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here uses these; deny by default.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },

  // The GitHub setup helpers live in apps/api but are called from a browser
  // session, which only this app has. Both run in the same trust boundary.
};

export default nextConfig;
