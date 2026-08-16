import type pg from "pg";
import type { Redis } from "ioredis";
import type { ApyAdapter, Market, MarketRates, Protocol } from "./types.js";
import {
  getMarketByKey,
  getMarketByReserve,
  getRates,
  insertMarket,
  upsertRates,
} from "./db/queries.js";
import { getCachedRates, setCachedRates } from "./cache/redis.js";

export type RateStatus = "ok" | "unavailable";

export type ResolvedRate = {
  status: RateStatus;
  rates: MarketRates | null;
  marketId: string;
  updatedAt: string | null;
};

export type MorphoMarketDescriptor = {
  kind: "morpho";
  chainId: number;
  marketKey: `0x${string}`;
  name: string;
};

export type StakingMarketDescriptor = {
  kind: "staking";
  chainId: number;
  token: `0x${string}`;
  name: string;
};

export type MarketDescriptor = MorphoMarketDescriptor | StakingMarketDescriptor;

export class ApyResolver {
  private readonly pool: pg.Pool;
  private readonly redis: Redis;
  private readonly adapters: Map<Protocol, ApyAdapter>;
  private readonly maxStalenessMs: number;

  constructor(deps: {
    pool: pg.Pool;
    redis: Redis;
    adapters: Map<Protocol, ApyAdapter>;
    maxStalenessMs: number;
  }) {
    this.pool = deps.pool;
    this.redis = deps.redis;
    this.adapters = deps.adapters;
    this.maxStalenessMs = deps.maxStalenessMs;
  }

  async resolve(descriptor: MarketDescriptor): Promise<ResolvedRate> {
    const market = await this.findOrRegister(descriptor);

    const cached = await getCachedRates(this.redis, market.marketId);
    if (cached && this.isFresh(cached.updatedAt)) {
      return {
        status: "ok",
        rates: cached,
        marketId: market.marketId,
        updatedAt: cached.updatedAt,
      };
    }

    const stored = await getRates(this.pool, market.marketId);
    if (stored && this.isFresh(stored.updatedAt)) {
      return {
        status: "ok",
        rates: stored,
        marketId: market.marketId,
        updatedAt: stored.updatedAt,
      };
    }

    return this.liveFetch(market);
  }

  private async findOrRegister(descriptor: MarketDescriptor): Promise<Market> {
    if (descriptor.kind === "morpho") {
      const existing = await getMarketByKey(
        this.pool,
        "morpho",
        descriptor.chainId,
        descriptor.marketKey,
      );
      if (existing) return existing;

      const market: Market = {
        marketId: `morpho-${descriptor.chainId}-${descriptor.marketKey.toLowerCase()}`,
        protocol: "morpho",
        chainId: descriptor.chainId,
        name: descriptor.name,
        reserveAddress: null,
        marketKey: descriptor.marketKey,
        enabled: true,
      };
      await insertMarket(this.pool, market);
      return market;
    }

    const existing = await getMarketByReserve(
      this.pool,
      "staking",
      descriptor.chainId,
      descriptor.token,
    );
    if (existing) return existing;

    const market: Market = {
      marketId: `staking-${descriptor.chainId}-${descriptor.token.toLowerCase()}`,
      protocol: "staking",
      chainId: descriptor.chainId,
      name: descriptor.name,
      reserveAddress: descriptor.token,
      marketKey: null,
      enabled: true,
    };
    await insertMarket(this.pool, market);
    return market;
  }

  private async liveFetch(market: Market): Promise<ResolvedRate> {
    const adapter = this.adapters.get(market.protocol);
    if (!adapter) {
      return {
        status: "unavailable",
        rates: null,
        marketId: market.marketId,
        updatedAt: null,
      };
    }

    try {
      const ratesMap = await adapter.getRatesBatch([market], market.chainId);
      const rates = ratesMap.get(market.marketId);
      if (!rates) {
        return {
          status: "unavailable",
          rates: null,
          marketId: market.marketId,
          updatedAt: null,
        };
      }

      const updatedAt = new Date().toISOString();
      await upsertRates(this.pool, market.marketId, rates);
      await setCachedRates(this.redis, market.marketId, {
        ...rates,
        updatedAt,
      });

      return { status: "ok", rates, marketId: market.marketId, updatedAt };
    } catch {
      return {
        status: "unavailable",
        rates: null,
        marketId: market.marketId,
        updatedAt: null,
      };
    }
  }

  private isFresh(updatedAt: string): boolean {
    return Date.now() - new Date(updatedAt).getTime() <= this.maxStalenessMs;
  }
}
