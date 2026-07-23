/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // libsodium-wrappers ships an internal .mjs that webpack cannot resolve
    // when bundled. It only ever runs server-side (sealing GitHub Actions
    // secrets), so leaving it external is both correct and sufficient.
    serverComponentsExternalPackages: [
      "@prisma/client",
      "bcryptjs",
      "libsodium-wrappers",
      "libsodium",
    ],
  },
  transpilePackages: ["@aitg/database", "@aitg/shared", "@aitg/ui"],
  // The GitHub setup helpers live in apps/api but are called from a browser
  // session, which only this app has. Both run in the same trust boundary.
};
export default nextConfig;
