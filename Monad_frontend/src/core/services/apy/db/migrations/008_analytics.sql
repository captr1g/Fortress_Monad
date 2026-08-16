-- Product analytics. Mirrors the idempotent schema in
-- src/core/services/analytics/db.ts, which is what actually applies these on an
-- existing database (this directory is only replayed when Postgres initializes
-- an empty data volume).
--
-- Wallets are stored as lowercased addresses, not hashed: tracked_wallets,
-- user_positions and saved_strategies already hold raw addresses in this same
-- database, so hashing only these two tables didn't stop anyone with DB
-- access from reading them — it only blocked joining "who saved a strategy"
-- against "who deployed one". Privacy comes from a read-only Postgres role
-- scoped to daily_funnel/user_cohorts, not from the schema.

CREATE TABLE IF NOT EXISTS app_user (
  wallet        TEXT PRIMARY KEY,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  login_count   INTEGER     NOT NULL DEFAULT 1,
  chain_id      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_user_first_seen ON app_user (first_seen_at);
CREATE INDEX IF NOT EXISTS idx_app_user_last_seen ON app_user (last_seen_at);

-- Append-only: nothing in the codebase deletes from this table. The operational
-- tables (tracked_wallets, user_positions) prune on a 7-day TTL, so this is the
-- only place long-run history survives.
CREATE TABLE IF NOT EXISTS user_event (
  id     BIGSERIAL PRIMARY KEY,
  wallet TEXT,
  event  TEXT NOT NULL,
  ts     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  meta   JSONB
);

CREATE INDEX IF NOT EXISTS idx_user_event_event_ts ON user_event (event, ts);
CREATE INDEX IF NOT EXISTS idx_user_event_wallet ON user_event (wallet);

DROP VIEW IF EXISTS daily_funnel;
CREATE VIEW daily_funnel AS
SELECT
  date_trunc('day', ts)                                           AS day,
  COUNT(DISTINCT wallet) FILTER (WHERE event = 'connected')       AS connected,
  COUNT(DISTINCT wallet) FILTER (WHERE event = 'plan_generated')  AS generated,
  COUNT(DISTINCT wallet) FILTER (WHERE event = 'strategy_saved')  AS saved,
  COUNT(DISTINCT wallet) FILTER (WHERE event = 'position_opened') AS deployed
FROM user_event
GROUP BY 1
ORDER BY 1 DESC;

DROP VIEW IF EXISTS user_cohorts;
CREATE VIEW user_cohorts AS
SELECT
  date_trunc('week', first_seen_at)                                 AS cohort_week,
  COUNT(*)                                                          AS wallets,
  COUNT(*) FILTER (WHERE login_count > 1)                           AS returned,
  COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '30 days') AS active_30d
FROM app_user
GROUP BY 1
ORDER BY 1 DESC;
