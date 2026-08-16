import type { NextConfig } from "next";
import path from "path";

// Server-side proxy target for the /api/* rewrite below. Distinct from
// NEXT_PUBLIC_API_BASE, which the BROWSER uses and is inlined at build time.
// Inside docker compose this is http://backend:3000 (the service name); the
// fallback is for `next dev` against a backend on the same machine. It used to
// default to a Cloud Run URL from an earlier deployment, which silently sent
// local traffic to a stale environment.
const BACKEND_ORIGIN = process.env.BACKEND_API_ORIGIN ?? "http://localhost:3000";

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
