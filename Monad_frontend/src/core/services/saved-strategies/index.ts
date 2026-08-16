import { getPool } from "../apy/db/client.js";
import { loadPositionsConfig } from "../positions/config.js";
import { SavedStrategiesService } from "./saved-strategies.service.js";
import type pg from "pg";

// Idempotent table creation, mirroring migration 006_saved_strategies.sql, so it
// works on a fresh DB without a separate migration step.
async function ensureSchema(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saved_strategies (
      id         TEXT PRIMARY KEY,
      wallet     TEXT NOT NULL,
      name       TEXT NOT NULL,
      prompt     TEXT NOT NULL,
      preview    JSONB NOT NULL,
      saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_saved_strategies_wallet ON saved_strategies(wallet)`,
  );
  // Additive migration for DBs created before the activity columns existed.
  await pool.query(
    `ALTER TABLE saved_strategies ADD COLUMN IF NOT EXISTS renamed_at TIMESTAMPTZ`,
  );
  await pool.query(
    `ALTER TABLE saved_strategies ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`,
  );
}

export async function startSavedStrategiesService(): Promise<SavedStrategiesService> {
  const config = loadPositionsConfig();
  const pool = getPool(config.APY_DATABASE_URL);

  await ensureSchema(pool);

  console.log("[saved-strategies-service] Started");
  return new SavedStrategiesService({ pool });
}

export { SavedStrategiesService } from "./saved-strategies.service.js";
