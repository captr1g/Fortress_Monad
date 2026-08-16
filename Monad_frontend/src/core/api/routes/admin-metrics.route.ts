import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { AnalyticsService } from "../../services/analytics/index.js";
import { createAdminMiddleware } from "../../services/auth/middleware.js";

/**
 * GET /admin/metrics — funnel and retention aggregates for the dashboard.
 *
 * Registered only when BOTH analytics and Redis are available, and only ever
 * behind the admin allowlist. Aggregates are still business data: growth
 * numbers, and (via daily activity) a coarse signal of when the app is used.
 * Nothing here exposes a wallet address — every row is a COUNT over hashes.
 */
export function registerAdminMetricsRoutes(
  app: FastifyInstance,
  analytics: AnalyticsService,
  redis: Redis,
  adminWallets: string[],
): void {
  const preHandler = [createAdminMiddleware(redis, adminWallets)];

  const handleMetrics = async (_req: unknown, reply: any) => {
    try {
      const metrics = await analytics.getMetrics();
      return reply.status(200).send(metrics);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[admin-metrics] query failed:", err);
      return reply
        .status(500)
        .send({ error: { stage: "admin-metrics", message } });
    }
  };

  app.get("/admin/metrics", { preHandler }, handleMetrics);
  app.get("/api/admin/metrics", { preHandler }, handleMetrics);
}
