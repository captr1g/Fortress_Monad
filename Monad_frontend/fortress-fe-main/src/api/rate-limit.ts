import type { FastifyRequest, FastifyReply } from "fastify";

interface WindowEntry {
  count: number;
  resetAt: number;
}

/**
 * Creates a rate limiter middleware for Fastify that limits the number of requests from a single IP address within a specified time window. The middleware tracks request counts and reset times in memory, and responds with a 429 status code when the limit is exceeded.
 * @param maxRequests
 * @param windowMs
 * @returns
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const windows = new Map<string, WindowEntry>();

  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const ip = request.ip;
    const now = Date.now();
    const entry = windows.get(ip);

    if (!entry || now >= entry.resetAt) {
      windows.set(ip, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;

    if (entry.count > maxRequests) {
      reply.status(429).send({
        error: {
          stage: "api",
          category: "validation",
          message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${windowMs / 1000} seconds.`,
        },
      });
      return;
    }
  };
}
