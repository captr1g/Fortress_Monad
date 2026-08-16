import type { FastifyInstance } from "fastify";
import type { Address, PublicClient } from "viem";
import { loadApyConfig } from "./config.js";
import { MONAD_CHAIN_ID } from "@chains/evm/config/monad.js";
import { getPool } from "./db/client.js";
import { connectRedis } from "./cache/redis.js";
import { AaveAdapter } from "./adapters/aave.js";
import { MorphoAdapter } from "./adapters/morpho.js";
import { StakingAdapter } from "./adapters/staking.js";
import { registerApyRoutes } from "../../api/routes/apy.route.js";
import { startPoller } from "./poller/index.js";
import { ApyResolver } from "./resolver.js";
import type { ApyAdapter, Protocol } from "./types.js";

type ApyServiceDeps = {
  getClient: (chainId: number) => PublicClient;
};

// Start the service, load the config, set the db and redis, setup the adapters, start the poller
export async function startApyService(
  app: FastifyInstance,
  deps: ApyServiceDeps,
): Promise<ApyResolver> {
  const config = loadApyConfig();
  const pool = getPool(config.APY_DATABASE_URL);
  const redis = await connectRedis(config.APY_REDIS_URL);

  const aaveAdapter = new AaveAdapter(deps.getClient, {
    [MONAD_CHAIN_ID]: config.AAVE_POOL_MONAD as Address,
  });

  const morphoAdapter = new MorphoAdapter();
  const stakingAdapter = new StakingAdapter();

  const adapters = new Map<Protocol, ApyAdapter>([
    ["aave", aaveAdapter],
    ["morpho", morphoAdapter],
    ["staking", stakingAdapter],
  ]);

  registerApyRoutes(app, { pool, redis });

  startPoller({
    pool,
    redis,
    adapters,
    intervalMs: config.APY_POLL_INTERVAL_MS,
  });

  console.log(
    `[apy-service] Started — polling every ${config.APY_POLL_INTERVAL_MS}ms`,
  );

  return new ApyResolver({
    pool,
    redis,
    adapters,
    maxStalenessMs: config.APY_MAX_STALENESS_MS,
  });
}
