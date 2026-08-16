/**
 * POST /fortress/positions/refresh
 *
 * Forces a fresh read of on-chain position data for a given wallet.
 * Safe to call immediately after a wallet connects (first paint) or
 * after an entry/exit tx confirms so the new/changed position shows
 * up right away instead of waiting for the background poller.
 *
 * Deduplication is handled with a short Redis lock
 * (key: "positions:refresh:<wallet>") so rapid-fire calls from the
 * frontend (e.g. tx confirmed + component remount) collapse into a
 * single upstream read within the lock window.
 */

import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Key prefix for position cache entries written by the poller / GET handler. */
const CACHE_PREFIX = "positions:";

/** Key prefix for the per-wallet refresh dedup lock. */
const LOCK_PREFIX = "positions:refresh:";

/**
 * How long (seconds) the Redis lock is held after a refresh is queued.
 * Calls arriving within this window return { queued: false, reason: "debounced" }.
 */
const LOCK_TTL_SECONDS = 5;

/**
 * After a refresh the positions cache entry is evicted so the next
 * GET /fortress/positions fetches live data from the upstream API.
 * The upstream fetch is done lazily (on the next GET) to keep this
 * endpoint cheap and non-blocking.
 */

// ── Request schema ────────────────────────────────────────────────────────────

const RefreshBodySchema = z.object({
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
});

// ── Deps ──────────────────────────────────────────────────────────────────────

export type PositionsRouteDeps = {
  redis: Redis;
};

// ── Registration ──────────────────────────────────────────────────────────────

export function registerPositionsRoutes(
  app: FastifyInstance,
  deps: PositionsRouteDeps,
): void {
  const { redis } = deps;

  /**
   * POST /fortress/positions/refresh
   *
   * Body: { walletAddress: "0x..." }
   *
   * Response 200: { queued: true }
   * Response 200: { queued: false, reason: "debounced" }  — lock already held
   * Response 400: validation error
   */
  app.post("/fortress/positions/refresh", async (req, reply) => {
    // ── Validate body ────────────────────────────────────────────────────────
    let body: z.infer<typeof RefreshBodySchema>;
    try {
      body = RefreshBodySchema.parse(req.body);
    } catch (err) {
      return reply.status(400).send({
        error: {
          stage: "api",
          category: "validation",
          message:
            err instanceof z.ZodError
              ? err.issues.map((i) => i.message).join(", ")
              : "Invalid request body",
        },
      });
    }

    const wallet = body.walletAddress.toLowerCase();
    const lockKey = `${LOCK_PREFIX}${wallet}`;

    // ── Acquire dedup lock (NX = only set if not exists) ─────────────────────
    // SET key value EX ttl NX — returns "OK" on success, null if already held.
    const acquired = await redis
      .set(lockKey, "1", "EX", LOCK_TTL_SECONDS, "NX")
      .catch(() => null);

    if (!acquired) {
      // Another refresh is already in flight for this wallet — skip.
      return reply.status(200).send({ queued: false, reason: "debounced" });
    }

    // ── Evict the stale cache entry so next GET fetches live data ─────────────
    const cacheKey = `${CACHE_PREFIX}${wallet}`;
    await redis.del(cacheKey).catch(() => {
      // Non-fatal — worst case the GET endpoint serves slightly stale data.
      console.warn(
        `[positions/refresh] Failed to evict cache for ${wallet}`,
      );
    });

    console.log(`[positions/refresh] Cache evicted for ${wallet}`);

    return reply.status(200).send({ queued: true });
  });
}
