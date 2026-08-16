import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Redis } from "ioredis";
import { getAllMarkets, getRates } from "./db/queries.js";
import { getCachedRates } from "./cache/redis.js";
import { getPollerState } from "./poller/index.js";

type RouteDeps = {
  pool: pg.Pool;
  redis: Redis;
};

/**
 * Stable API shape for a single market returned by GET /apy/markets.
 * Frontend consumers should treat this as the contract.
 */
export type MarketApiResponse = {
  id: string;           // Internal market identifier (e.g. Morpho market hash or Aave reserve address)
  protocol: string;     // "morpho" | "aave"
  chainId: number;
  name: string;         // Human-readable market name
  enabled: boolean;
  supplyApy: number | null;
  borrowApy: number | null;
  rewardsApy: number | null;
  updatedAt: string | null; // ISO timestamp of last rate poll, or null if never polled
};

export function registerApyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { pool, redis } = deps;

  /**
   * GET /apy/markets
   * Returns all tracked markets with their latest APY rates.
   * Response: { markets: MarketApiResponse[] }
   */
  app.get("/apy/markets", async (_req, reply) => {
    const markets = await getAllMarkets(pool);

    // Enrich each market with its latest rates (prefer cache, fall back to DB)
    const enriched: MarketApiResponse[] = await Promise.all(
      markets.map(async (m) => {
        let supplyApy: number | null = null;
        let borrowApy: number | null = null;
        let rewardsApy: number | null = null;
        let updatedAt: string | null = null;

        const cached = await getCachedRates(redis, m.marketId);
        if (cached) {
          supplyApy = cached.supplyApy;
          borrowApy = cached.borrowApy ?? null;
          rewardsApy = cached.rewardsApy ?? null;
          updatedAt = (cached as any).updatedAt ?? null;
        } else {
          const dbRates = await getRates(pool, m.marketId);
          if (dbRates) {
            supplyApy = dbRates.supplyApy;
            borrowApy = dbRates.borrowApy ?? null;
            rewardsApy = dbRates.rewardsApy ?? null;
            updatedAt = dbRates.updatedAt;
          }
        }

        return {
          id: m.marketId,
          protocol: m.protocol,
          chainId: m.chainId,
          name: m.name,
          enabled: m.enabled,
          supplyApy,
          borrowApy,
          rewardsApy,
          updatedAt,
        };
      }),
    );

    return reply.send({ markets: enriched });
  });

  // fetch rate per marketid
  app.get<{ Params: { marketId: string } }>("/apy/:marketId", async (req, reply) => {
    const { marketId } = req.params;

    const cached = await getCachedRates(redis, marketId);
    if (cached) {
      return reply.send({ marketId, ...cached });
    }

    const dbRates = await getRates(pool, marketId);
    if (!dbRates) {
      return reply.status(404).send({ error: { message: `Market not found: ${marketId}` } });
    }

    return reply.send({ marketId, ...dbRates });
  });

  // fetch rates for markets in batch
  app.get<{ Querystring: { marketIds?: string } }>("/apy/batch", async (req, reply) => {
    const raw = req.query.marketIds;
    if (!raw) {
      return reply.status(400).send({ error: { message: "marketIds query param required" } });
    }

    const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 50) {
      return reply.status(400).send({ error: { message: "Provide 1-50 market IDs" } });
    }

    const rates: Record<string, unknown> = {};
    for (const id of ids) {
      const cached = await getCachedRates(redis, id);
      if (cached) {
        rates[id] = cached;
        continue;
      }
      const dbRates = await getRates(pool, id);
      if (dbRates) {
        rates[id] = dbRates;
      }
    }

    return reply.send({ rates });
  });

  // Heart monitor
  app.get("/apy/health", async (_req, reply) => {
    const pollerState = getPollerState();
    return reply.send({ status: "ok", ...pollerState });
  });
}
