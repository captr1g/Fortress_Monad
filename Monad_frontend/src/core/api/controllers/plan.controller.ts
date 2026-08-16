import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import type { Orchestrator, PlanResult } from "../../orchestrator.js";
import { PlannerRefusal, InputTokenMismatch } from "@shared/errors.js";
import { FortressLogger } from "@shared/logger.js";
import { findTokenById } from "../../registry/index.js";
import { suggestionsForError } from "@chains/evm/execution/suggestions.js";
import { createPlanJob, getPlanJob, resolvePlanJob, rejectPlanJob } from "../../services/plan-jobs.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

const PlanRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  inputToken: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
  // Frontend may pass these but they're informational only
  contracts: z.string().optional(),
});

export function serializePlanResult(result: PlanResult) {
  return {
    intent: result.intent,
    description: result.description,
    transactions: result.transactions.map((tx) => ({
      to: tx.to,
      data: tx.data,
      value: tx.value.toString(),
      chainId: tx.chainId,
    })),
    simulation: {
      success: result.simulation.success,
      gasUsed: result.simulation.gasUsed.toString(),
      error: result.simulation.error ?? null,
    },
    apy: result.apy ?? null,
    depositApy: result.depositApy ?? null,
    loopSuggestion: result.loopSuggestion ?? null,
  };
}

// Same shape/status codes /fortress/plan always returned synchronously —
// factored out so the async worker path produces byte-identical error
// bodies once the frontend picks them up off the job.
function buildErrorPayload(
  err: unknown,
  chainId: number,
): { status: number; body: unknown } {
  const suggestions = suggestionsForError(err, chainId);

  if (err instanceof PlannerRefusal) {
    return {
      status: 422,
      body: { error: { stage: "planner", message: err.message, suggestions } },
    };
  }

  if (err instanceof InputTokenMismatch) {
    return {
      status: 400,
      body: { error: { stage: "planner", message: err.message, suggestions } },
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    status: 422,
    body: { error: { stage: "builder", message, suggestions } },
  };
}

export class FortressController {
  private readonly orchestrator: Orchestrator;
  private readonly chainKey: string;
  private readonly chainId: number;
  private readonly redis?: Redis;
  // Base URL the worker route self-invokes on (same Cloud Run instance) —
  // e.g. http://127.0.0.1:${PORT}. Undefined only disables the async path
  // (falls back to synchronous), never crashes.
  private readonly selfBaseUrl?: string;
  private readonly analytics?: AnalyticsService;

  constructor(
    orchestrator: Orchestrator,
    chainKey: string,
    chainId: number,
    redis?: Redis,
    selfBaseUrl?: string,
    analytics?: AnalyticsService,
  ) {
    this.orchestrator = orchestrator;
    this.chainKey = chainKey;
    this.chainId = chainId;
    this.redis = redis;
    this.selfBaseUrl = selfBaseUrl;
    this.analytics = analytics;
  }

  private async resolveInputToken(inputTokenAddress?: string) {
    if (!inputTokenAddress) return undefined;
    const token = findTokenById(this.chainId, inputTokenAddress);
    if (!token) {
      // InputTokenMismatch maps to 400 in buildErrorPayload — the right
      // status for a client-supplied address that isn't in the registry.
      throw new InputTokenMismatch(inputTokenAddress, inputTokenAddress);
    }
    return token;
  }

  // Runs the actual (slow) planning work and records the outcome on the job.
  // Called either directly (no Redis/selfBaseUrl configured — synchronous
  // fallback) or via the self-invoked /internal/plan-worker route.
  private async runPlan(
    jobId: string | undefined,
    body: z.infer<typeof PlanRequestSchema>,
  ): Promise<{ status: number; body: unknown }> {
    const log = FortressLogger.newRequest().at({
      route: "POST /fortress/plan",
      file: "plan.controller.ts",
      fn: "runPlan",
    });

    try {
      const inputToken = await this.resolveInputToken(body.inputToken);
      const result = await this.orchestrator.plan(
        body.prompt,
        this.chainKey,
        body.walletAddress as `0x${string}`,
        log,
        { inputToken },
      );
      const payload = { status: 200, body: serializePlanResult(result) };
      if (jobId && this.redis) await resolvePlanJob(this.redis, jobId, payload);

      // Counted here rather than in plan() because plan() returns 202 before any
      // planning happens — emitting there would count attempts, and a funnel step
      // that includes failed generations tells you nothing about whether the
      // product works. The address is the client-claimed one from the body (the
      // worker route is self-invoked and carries no session cookie); that's fine
      // for counting, but it is NOT an authorization signal and must not be used
      // as one.
      await this.analytics?.record("plan_generated", body.walletAddress);

      return payload;
    } catch (err: unknown) {
      if (err instanceof PlannerRefusal) log.refuse(err.message);
      else log.error("FAILED", err);
      const payload = buildErrorPayload(err, this.chainId);
      if (jobId && this.redis) await rejectPlanJob(this.redis, jobId, payload);
      return payload;
    }
  }

  // POST /fortress/plan — returns a job id almost immediately when the
  // async path is available; otherwise runs synchronously exactly like
  // before (e.g. local dev without Redis configured).
  async plan(request: FastifyRequest, reply: FastifyReply) {
    const body = PlanRequestSchema.parse(request.body);

    if (!this.redis || !this.selfBaseUrl) {
      const { status, body: responseBody } = await this.runPlan(undefined, body);
      return reply.status(status).send(responseBody);
    }

    const jobId = await createPlanJob(this.redis);

    // Fire the self-invoked worker request WITHOUT awaiting it. This becomes
    // its own genuine incoming request against this Cloud Run instance, so
    // CPU stays allocated for its full duration regardless of the fact that
    // THIS (outer) request already returned.
    fetch(`${this.selfBaseUrl}/internal/plan-worker/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(async (err) => {
      if (this.redis) {
        await rejectPlanJob(this.redis, jobId, {
          status: 422,
          body: { error: { stage: "api", message: "Failed to start plan worker" } },
        }).catch(() => { });
      }
      console.error("[plan] failed to dispatch worker:", err);
    });

    return reply.status(202).send({ jobId });
  }

  // POST /internal/plan-worker/:jobId — self-invoked only, never called by
  // the frontend. Not exposed through the CORS-configured public routes list;
  // guarded by requiring a matching pending job so a stray external call
  // can't use it as a free LLM proxy.
  async planWorker(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    if (!this.redis) return reply.status(500).send({ error: { stage: "api", message: "Redis not configured" } });

    const existing = await getPlanJob(this.redis, jobId);
    if (!existing || existing.status !== "pending") {
      return reply.status(404).send({ error: { stage: "api", message: "No pending job for this id" } });
    }

    const body = PlanRequestSchema.parse(request.body);
    await this.runPlan(jobId, body);
    // Nothing reads this response — the frontend polls GET /fortress/plan/:jobId.
    return reply.status(200).send({ ok: true });
  }

  // GET /fortress/plan/:jobId — the frontend polls this until status !== "pending".
  async getJob(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    if (!this.redis) return reply.status(500).send({ error: { stage: "api", message: "Redis not configured" } });

    const job = await getPlanJob(this.redis, jobId);
    if (!job) {
      return reply.status(404).send({ error: { stage: "api", message: "Job not found or expired" } });
    }
    if (job.status === "pending") {
      return reply.status(200).send({ status: "pending" });
    }
    // done/error: pass through the exact status+body runPlan recorded.
    const recorded = job as { status: "done" | "error"; result?: unknown; error?: unknown };
    const payload = (recorded.result ?? recorded.error) as { status: number; body: unknown };
    return reply.status(200).send({ status: job.status, httpStatus: payload.status, body: payload.body });
  }
}
