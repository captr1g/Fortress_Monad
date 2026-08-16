// General rate limiter — uses Redis when available for shared state across
// instances, or falls back to in-memory with TTL eviction for local dev.
// Fails CLOSED when Redis errors (rejects rather than allowing unlimited).

import type {
  FastifyRequest,
  FastifyReply,
  HookHandlerDoneFunction,
} from "fastify";
import type { Redis } from "ioredis";

export function createRedisRateLimiter(
  redis: Redis,
  maxRequests: number,
  windowMs: number,
  skip?: (request: FastifyRequest) => boolean,
) {
  const windowSec = Math.ceil(windowMs / 1000);
  const KEY_PREFIX = "rl:general:";

  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    if (skip?.(request)) return;

    const ip = request.ip || "unknown";
    const key = `${KEY_PREFIX}${ip}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSec);
      }

      if (count > maxRequests) {
        reply
          .status(429)
          .send({ error: { stage: "api", message: "Too many requests" } });
      }
    } catch (err) {
      // Fail closed: if Redis is down, reject to prevent abuse
      console.error("[rate-limit] redis error:", (err as Error)?.message ?? err);
      reply
        .status(503)
        .send({ error: { stage: "api", message: "Rate limiter unavailable" } });
    }
  };
}

// ── In-memory limiter (local dev / no Redis) ─────────────────────────────────
// Uses a Map with periodic cleanup to prevent unbounded growth.

export function createRateLimiter(
  maxRequests: number,
  windowMs: number,
  skip?: (request: FastifyRequest) => boolean,
) {
  const hits = new Map<string, number[]>();

  // Periodic cleanup: evict stale entries every 60s to prevent memory leak
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const cutoff = now - windowMs;
    for (const [ip, timestamps] of hits) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, filtered);
      }
    }
  }, 60_000);

  // Don't prevent Node from exiting
  if (cleanupInterval.unref) cleanupInterval.unref();

  return function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction,
  ): void {
    if (skip?.(request)) {
      done();
      return;
    }

    const ip = request.ip || "unknown";
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = hits.get(ip) ?? [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      reply
        .status(429)
        .send({ error: { stage: "api", message: "Too many requests" } });
      return;
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    done();
  };
}
