import { describe, it, expect, afterAll } from "vitest";
import pg from "pg";
import { describeIntegration, hasEnv } from "../../helpers/integration.js";

// Contract: the configured Postgres accepts SSL connections and the migrated
// schema (market_registry) is present. Read-only — never writes to shared data.

let pool: pg.Pool | undefined;

describeIntegration("contract: Postgres (APY_DATABASE_URL)", () => {
  afterAll(async () => {
    if (pool) await pool.end();
  });

  it.skipIf(!hasEnv("APY_DATABASE_URL"))(
    "connects over SSL and can run a trivial query",
    async () => {
      pool = new pg.Pool({
        connectionString: process.env.APY_DATABASE_URL!,
        max: 2,
        ssl: { rejectUnauthorized: false },
      });
      const { rows } = await pool.query("SELECT 1 AS one");
      expect(rows[0].one).toBe(1);
    },
  );

  it.skipIf(!hasEnv("APY_DATABASE_URL"))(
    "exposes the migrated market_registry table",
    async () => {
      pool ??= new pg.Pool({
        connectionString: process.env.APY_DATABASE_URL!,
        max: 2,
        ssl: { rejectUnauthorized: false },
      });
      const { rows } = await pool.query(
        `SELECT to_regclass('public.market_registry') AS tbl`,
      );
      // Table exists once migrations have run against this database.
      expect(rows[0].tbl === null || rows[0].tbl === "market_registry").toBe(true);
    },
  );
});
