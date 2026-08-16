import type { FastifyRequest, FastifyReply } from "fastify";
import type pg from "pg";
import type { Redis } from "ioredis";
import { getAllMarkets, getRates } from "../../services/apy/db/queries.js";
import { getCachedRates } from "../../services/apy/cache/redis.js";
import { getPollerState } from "../../services/apy/poller/index.js";

export class ApyController {
  private readonly pool: pg.Pool;
  private readonly redis: Redis;

  constructor(pool: pg.Pool, redis: Redis) {
    this.pool = pool;
    this.redis = redis;
  }

  async markets(_request: FastifyRequest, reply: FastifyReply) {
    const markets = await getAllMarkets(this.pool);

    const enriched = await Promise.all(
      markets.map(async (m) => {
        let supplyApy: number | null = null;
        let borrowApy: number | null = null;
        let rewardsApy: number | null = null;
        let updatedAt: string | null = null;

        const cached = await getCachedRates(this.redis, m.marketId);
        if (cached) {
          supplyApy = cached.supplyApy;
          borrowApy = cached.borrowApy ?? null;
          rewardsApy = cached.rewardsApy ?? null;
          updatedAt = (cached as any).updatedAt ?? null;
        } else {
          const dbRates = await getRates(this.pool, m.marketId);
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
  }

  async rateByMarket(request: FastifyRequest, reply: FastifyReply) {
    const { marketId } = request.params as { marketId: string };

    const cached = await getCachedRates(this.redis, marketId);
    if (cached) return reply.send({ marketId, ...cached });

    const dbRates = await getRates(this.pool, marketId);
    if (!dbRates) {
      return reply.status(404).send({ error: { message: `Market not found: ${marketId}` } });
    }
    return reply.send({ marketId, ...dbRates });
  }

  async batch(request: FastifyRequest, reply: FastifyReply) {
    const { marketIds } = request.query as { marketIds?: string };
    if (!marketIds) {
      return reply.status(400).send({ error: { message: "marketIds query param required" } });
    }

    const ids = marketIds.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 50) {
      return reply.status(400).send({ error: { message: "Provide 1-50 market IDs" } });
    }

    const rates: Record<string, unknown> = {};
    for (const id of ids) {
      const cached = await getCachedRates(this.redis, id);
      if (cached) { rates[id] = cached; continue; }
      const dbRates = await getRates(this.pool, id);
      if (dbRates) rates[id] = dbRates;
    }
    return reply.send({ rates });
  }

  async health(_request: FastifyRequest, reply: FastifyReply) {
    const pollerState = getPollerState();
    return reply.send({ status: "ok", ...pollerState });
  }
}
