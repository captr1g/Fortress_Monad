// Redis-backed job store for async plan generation. Exists because Vercel
// imposes a hard, unconfigurable ~120s timeout on rewrites to an external
// destination (like our /api/* proxy to this backend) — but a complex
// multi-step strategy prompt can legitimately take gpt-5-nano 50-100+
// seconds to reason through. Rather than race that ceiling, /fortress/plan
// returns a job id almost immediately and the frontend polls for the
// result — every individual request stays fast, so neither Vercel's proxy
// timeout nor Cloud Run's request-scoped CPU allocation is ever at risk.

import type { Redis } from "ioredis";
import crypto from "node:crypto";

const JOB_TTL_SECONDS = 15 * 60; // long enough for a slow plan + a slow poller
const KEY_PREFIX = "plan-job:";

export type PlanJobState =
  | { status: "pending" }
  | { status: "done"; result: unknown }
  | { status: "error"; error: unknown };

export async function createPlanJob(redis: Redis): Promise<string> {
  const jobId = crypto.randomUUID();
  await redis.set(
    `${KEY_PREFIX}${jobId}`,
    JSON.stringify({ status: "pending" } satisfies PlanJobState),
    "EX",
    JOB_TTL_SECONDS,
  );
  return jobId;
}

export async function getPlanJob(redis: Redis, jobId: string): Promise<PlanJobState | null> {
  const raw = await redis.get(`${KEY_PREFIX}${jobId}`);
  if (!raw) return null;
  return JSON.parse(raw) as PlanJobState;
}

export async function resolvePlanJob(redis: Redis, jobId: string, result: unknown): Promise<void> {
  await redis.set(
    `${KEY_PREFIX}${jobId}`,
    JSON.stringify({ status: "done", result } satisfies PlanJobState),
    "EX",
    JOB_TTL_SECONDS,
  );
}

export async function rejectPlanJob(redis: Redis, jobId: string, error: unknown): Promise<void> {
  await redis.set(
    `${KEY_PREFIX}${jobId}`,
    JSON.stringify({ status: "error", error } satisfies PlanJobState),
    "EX",
    JOB_TTL_SECONDS,
  );
}
