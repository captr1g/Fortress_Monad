import type pg from "pg";

// Events we count. Deliberately a closed set — this is a funnel, not a
// general-purpose event firehose. Every value here is one step in
// visitor → connected → generated → saved → deployed.
export type AnalyticsEvent =
  | "connected"
  | "plan_generated"
  | "strategy_saved"
  | "position_opened";

// Idempotent schema creation, mirroring migration 008_analytics.sql. Follows the
// same pattern as saved-strategies/index.ts and strategies/index.ts: the compose
// file mounts migrations at docker-entrypoint-initdb.d, which Postgres only runs
// when initializing an EMPTY data volume — so a new .sql file never reaches an
// existing database. Creating the schema at boot is what actually applies it.
export async function ensureAnalyticsSchema(pool: pg.Pool): Promise<void> {
  // One row per wallet. This is the durable account record the rest of the
  // system lacks: sessions expire after 7 days and tracked_wallets is pruned
  // on the same schedule, so without this table a user who stops visiting is
  // erased and last month becomes unknowable.
  //
  // Stores the lowercased address, not a hash. tracked_wallets, user_positions
  // and saved_strategies already store raw addresses in this same database —
  // hashing only this one table doesn't stop anyone with DB access from
  // reading it, so it bought no real privacy while costing every join between
  // "who saved a strategy" and "who deployed one". Keep addresses out of
  // *exports and dashboards* (a read-only Postgres role + the views below),
  // not out of the schema.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_user (
      wallet        TEXT PRIMARY KEY,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      login_count   INTEGER     NOT NULL DEFAULT 1,
      chain_id      INTEGER
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_app_user_first_seen ON app_user (first_seen_at)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_app_user_last_seen ON app_user (last_seen_at)`,
  );

  // Append-only. NOTHING deletes from this table — that is the entire point.
  // The operational tables (tracked_wallets, user_positions) prune correctly for
  // what they are (a polling work queue and a live-state cache); history lives here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_event (
      id     BIGSERIAL PRIMARY KEY,
      wallet TEXT,
      event  TEXT NOT NULL,
      ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      meta   JSONB
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_user_event_event_ts ON user_event (event, ts)`,
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_user_event_wallet ON user_event (wallet)`,
  );

  await ensureViews(pool);
}

// Read models. Views cost nothing (no storage, no writes) and exist so that a
// dashboard — Metabase, psql, whatever — can be pointed at a read-only role
// scoped to these views instead of the raw tables.
async function ensureViews(pool: pg.Pool): Promise<void> {
  // Dropped rather than CREATE OR REPLACE'd: replace only works if the new
  // definition keeps the same column names, types and order, so the first time
  // anyone edits a view below it would throw at boot. Views hold no data, so
  // recreating them costs nothing. Plain DROP (no CASCADE) on purpose — if
  // something else ever depends on these, we want the error, not the silent
  // destruction of whatever depended on them.
  await pool.query(`DROP VIEW IF EXISTS daily_funnel`);
  await pool.query(`DROP VIEW IF EXISTS user_cohorts`);

  await pool.query(`
    CREATE VIEW daily_funnel AS
    SELECT
      date_trunc('day', ts)                                           AS day,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'connected')       AS connected,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'plan_generated')  AS generated,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'strategy_saved')  AS saved,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'position_opened') AS deployed
    FROM user_event
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  await pool.query(`
    CREATE VIEW user_cohorts AS
    SELECT
      date_trunc('week', first_seen_at)                                   AS cohort_week,
      COUNT(*)                                                            AS wallets,
      COUNT(*) FILTER (WHERE login_count > 1)                             AS returned,
      COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '30 days')   AS active_30d
    FROM app_user
    GROUP BY 1
    ORDER BY 1 DESC
  `);
}

// Upserted on every successful sign-in: first_seen_at is written once and never
// moves, last_seen_at and login_count track return visits.
export async function upsertUser(
  pool: pg.Pool,
  wallet: string,
  chainId?: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO app_user (wallet, chain_id)
     VALUES ($1, $2)
     ON CONFLICT (wallet) DO UPDATE
       SET last_seen_at = NOW(),
           login_count  = app_user.login_count + 1,
           chain_id     = COALESCE(EXCLUDED.chain_id, app_user.chain_id)`,
    [wallet, chainId ?? null],
  );
}

export async function insertEvent(
  pool: pg.Pool,
  wallet: string | null,
  event: AnalyticsEvent,
  meta?: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `INSERT INTO user_event (wallet, event, meta) VALUES ($1, $2, $3)`,
    [wallet, event, meta ? JSON.stringify(meta) : null],
  );
}
