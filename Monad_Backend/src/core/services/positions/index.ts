import type { ApyResolver } from "../apy/resolver.js";
import { getPool } from "../apy/db/client.js";
import { connectRedis } from "../apy/cache/redis.js";
import { loadPositionsConfig } from "./config.js";
import { PositionsService } from "./service.js";
import { startPositionsPoller } from "./poller.js";
import type { Address } from "viem";
import type { AnalyticsService } from "../analytics/index.js";

type PositionsServiceDeps = {
  rpcUrl: string;
  morphoBlue: Address;
  chainId: number;
  apyResolver?: ApyResolver;
  analytics?: AnalyticsService;
};

export async function startPositionsService(
  deps: PositionsServiceDeps,
): Promise<PositionsService> {
  const config = loadPositionsConfig();
  const pool = getPool(config.APY_DATABASE_URL);
  const redis = await connectRedis(config.APY_REDIS_URL);

  const service = new PositionsService({
    pool,
    redis,
    rpcUrl: deps.rpcUrl,
    morphoBlue: deps.morphoBlue,
    chainId: deps.chainId,
    cacheTtlSeconds: config.POSITIONS_CACHE_TTL_SECONDS,
    staleMs: config.POSITIONS_STALE_MS,
    apyResolver: deps.apyResolver,
    analytics: deps.analytics,
  });

  startPositionsPoller({
    pool,
    service,
    intervalMs: config.POSITIONS_POLL_INTERVAL_MS,
    walletTtlDays: config.POSITIONS_WALLET_TTL_DAYS,
  });

  console.log(
    `[positions-service] Started — polling every ${config.POSITIONS_POLL_INTERVAL_MS}ms`,
  );

  return service;
}

export { PositionsService } from "./service.js";
export type { StoredPosition, PositionsResponse } from "./types.js";
