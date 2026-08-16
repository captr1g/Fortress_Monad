import type { NextConfig } from "next";
import path from "path";

const BACKEND_ORIGIN =
  process.env.BACKEND_API_ORIGIN ??
  "https://fortress-backend-210732125495.us-central1.run.app";

const nextConfig: NextConfig = {
  // Consume the shared package as TypeScript source (no build step).
  transpilePackages: ["@fortress/core"],
  // Pin the monorepo root so Turbopack doesn't get confused by the stale
  // package-lock.json that lives at /Users/anurag/package-lock.json.
  turbopack: {
    root: path.resolve(__dirname, "../../"),
  },
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
