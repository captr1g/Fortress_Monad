import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Orchestrator } from "../../orchestrator.js";
import { FortressController } from "../controllers/plan.controller.js";
import { createOptionalAuthMiddleware } from "../../services/auth/middleware.js";
import { createPlanRateLimiter } from "../middleware/plan-rate-limit.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

const PLAN_CALLS_PER_DAY = 60;

export function registerPlanRoutes(
  app: FastifyInstance,
  orchestrator: Orchestrator,
  chainKey: string,
  chainId: number,
  redis?: Redis,
  selfBaseUrl?: string,
  analytics?: AnalyticsService,
): void {
  const controller = new FortressController(
    orchestrator,
    chainKey,
    chainId,
    redis,
    selfBaseUrl,
    analytics,
  );
  const handlePlan = (req: any, reply: any) => controller.plan(req, reply);
  const handleWorker = (req: any, reply: any) =>
    controller.planWorker(req, reply);
  const handleGetJob = (req: any, reply: any) => controller.getJob(req, reply);

  // Plan rate limiter: Redis-backed per-day quota. Fails closed — if Redis
  // is absent, the plan endpoint still works but is unmetered (acceptable
  // only for local dev). DISABLE_PLAN_RATE_LIMIT is a dev-only override
  // that MUST be removed before production deployment.
  const rateLimitDisabled = process.env.DISABLE_PLAN_RATE_LIMIT === "true";
  if (rateLimitDisabled) {
    console.warn(
      "[WARN] Plan rate limit is DISABLED — do NOT deploy to production like this.",
    );
  }
  const preHandler = redis
    ? [
        createOptionalAuthMiddleware(redis),
        ...(rateLimitDisabled
          ? []
          : [createPlanRateLimiter(redis, PLAN_CALLS_PER_DAY)]),
      ]
    : [];

  app.post("/fortress/plan", { preHandler }, handlePlan);
  app.post("/api/fortress/plan", { preHandler }, handlePlan);

  // Self-invoked only (see FortressController.planWorker) — no rate-limit/
  // auth preHandler, since it's never reached from outside without already
  // knowing a live pending job id.
  app.post("/internal/plan-worker/:jobId", handleWorker);

  // Polling — deliberately cheap/fast, so it never risks Vercel's external-
  // rewrite timeout the way the original synchronous /fortress/plan could.
  app.get("/fortress/plan/:jobId", handleGetJob);
  app.get("/api/fortress/plan/:jobId", handleGetJob);
}
