import type { NextConfig } from "next";

const BACKEND_ORIGIN =
  process.env.BACKEND_API_ORIGIN ??
  "https://fortress-backend-210732125495.us-central1.run.app";

const nextConfig: NextConfig = {
  // Consume the shared package as TypeScript source (no build step).
  transpilePackages: ["@fortress/core"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_ORIGIN}/:path*`,
      },
    ];
  },
};

export default nextConfig;
