import type { FastifyInstance } from "fastify";
import type { PublicClient } from "viem";
import { loadApyConfig } from "./config.js";
import { getPool } from "./db/client.js";
import { connectRedis } from "./cache/redis.js";
import { AaveAdapter } from "./adapters/aave.js";
import { MorphoAdapter } from "./adapters/morpho.js";
import { registerApyRoutes } from "./routes.js";
import { startPoller } from "./poller/index.js";
import type { ApyAdapter, Protocol } from "./types.js";

type ApyServiceDeps = {
  getClient: (chainId: number) => PublicClient;
};

// Start the service, load the config, set the db and redis, setup the adapters, start the poller
export async function startApyService(app: FastifyInstance, deps: ApyServiceDeps): Promise<void> {
  const config = loadApyConfig();
  const pool = getPool(config.APY_DATABASE_URL);
  const redis = await connectRedis(config.APY_REDIS_URL);

  const aaveAdapter = new AaveAdapter(deps.getClient, {
    8453: config.AAVE_POOL_BASE as `0x${string}`,
  });

  const morphoAdapter = new MorphoAdapter();

  const adapters = new Map<Protocol, ApyAdapter>([
    ["aave", aaveAdapter],
    ["morpho", morphoAdapter],
  ]);

  registerApyRoutes(app, { pool, redis });

  startPoller({
    pool,
    redis,
    adapters,
    intervalMs: config.APY_POLL_INTERVAL_MS,
  });

  console.log(`[apy-service] Started — polling every ${config.APY_POLL_INTERVAL_MS}ms`);
}
