/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Prisma client and BullMQ are Node-only; bundling them into the
  // serverless/edge output breaks their native and dynamic-require paths.
  experimental: { serverComponentsExternalPackages: ["@prisma/client", "bullmq", "ioredis"] },
  transpilePackages: ["@aitg/database", "@aitg/shared"],

  // The API serves JSON to the CLI and to the dashboard's server, never to a
  // browser as a document, so the frame/referrer headers that apps/web needs
  // do not apply here. These two do.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },

};

export default nextConfig;
