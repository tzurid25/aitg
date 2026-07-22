/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"] },
  transpilePackages: ["@aitg/database", "@aitg/shared", "@aitg/ui"],
  // The GitHub setup helpers live in apps/api but are called from a browser
  // session, which only this app has. Both run in the same trust boundary.
};

export default nextConfig;
