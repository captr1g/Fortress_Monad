import { getPool } from "../apy/db/client.js";
import { loadPositionsConfig } from "../positions/config.js";
import type { Orchestrator } from "../../orchestrator.js";
import type { EvmKernel } from "@chains/evm/kernel.js";
import type { ApyResolverPort } from "../apy/types.js";
import { StrategiesService } from "./strategies.service.js";
import { startStrategiesPoller } from "./poller.js";
import type pg from "pg";

type StrategiesServiceDeps = {
  orchestrator: Orchestrator;
  kernel: EvmKernel;
  apyResolver?: ApyResolverPort;
  chainId: number;
  pollIntervalMs?: number;
};

// Idempotent table creation, mirroring migration 005_strategies.sql, so the catalog
// works on a fresh DB without a separate migration step.
async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strategy_catalog (
      id                TEXT PRIMARY KEY,
      chain_id          INTEGER NOT NULL,
      title             TEXT NOT NULL,
      summary           TEXT NOT NULL,
      prompt            TEXT NOT NULL,
      description       TEXT,
      leverage          NUMERIC,
      collateral_token  TEXT,
      borrow_market_key TEXT,
      snapshot          JSONB,
      net_apy           NUMERIC,
      collateral_apy    NUMERIC,
      borrow_apy        NUMERIC,
      rate_status       TEXT NOT NULL DEFAULT 'unavailable',
      seeded            BOOLEAN NOT NULL DEFAULT false,
      build_error       TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Additive migration for DBs created before the snapshot column existed.
  await pool.query(
    `ALTER TABLE strategy_catalog ADD COLUMN IF NOT EXISTS snapshot JSONB`,
  );
}

// Starts the curated-strategies catalog: seeds the structural build once (the
// "simulate once" step), then polls live market rates to keep net APY current.
export async function startStrategiesService(
  deps: StrategiesServiceDeps,
): Promise<StrategiesService> {
  const config = loadPositionsConfig();
  const pool = getPool(config.APY_DATABASE_URL);

  await ensureSchema(pool);

  const service = new StrategiesService({
    pool,
    orchestrator: deps.orchestrator,
    kernel: deps.kernel,
    apyResolver: deps.apyResolver,
    chainId: deps.chainId,
  });

  // Seed structural builds in the background so a slow planner/LiFi call never blocks
  // server startup. The rate poller starts immediately and refreshes whatever is seeded.
  void service
    .seed()
    .then(() => service.refreshRates())
    .catch((err) => console.error("[strategies-service] seed failed:", err));

  startStrategiesPoller({
    service,
    intervalMs: deps.pollIntervalMs ?? config.POSITIONS_POLL_INTERVAL_MS,
  });

  console.log("[strategies-service] Started");
  return service;
}

export { StrategiesService } from "./strategies.service.js";
