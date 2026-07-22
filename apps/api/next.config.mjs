/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Prisma client and BullMQ are Node-only; bundling them into the
  // serverless/edge output breaks their native and dynamic-require paths.
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bullmq", "ioredis"] },
  transpilePackages: ["@aitg/database", "@aitg/shared"],
};

export default nextConfig;
