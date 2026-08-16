// Daily quota for LLM-calling endpoints (currently just /fortress/plan).
// Keyed on a *verified* wallet (attached earlier in the chain by
// createOptionalAuthMiddleware) when signed in, or the request IP for the
// "explore without signing in" flow — never the client-supplied request body,
// since that's trivially spoofable per-request.
//
// No count is ever surfaced to the client: just a flat "try again tomorrow"
// once the limit is hit, so there's nothing to build a quota UI around and
// nothing for a caller to probe.

import type { FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";

const DAY_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = "plan-limit:";

export function createPlanRateLimiter(redis: Redis, maxPerDay: number) {
  return async function planRateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const identity = request.walletAddress
      ? `wallet:${request.walletAddress.toLowerCase()}`
      : `ip:${request.ip}`;
    const day = new Date().toISOString().slice(0, 10); // UTC calendar day
    const key = `${KEY_PREFIX}${identity}:${day}`;

    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, DAY_SECONDS);
    }

    if (count > maxPerDay) {
      reply.status(429).send({
        error: {
          stage: "api",
          category: "rate_limit",
          message: "You've reached today's limit for strategy generation. Try again tomorrow.",
        },
      });
    }
  };
}
