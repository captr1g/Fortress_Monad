CREATE TABLE IF NOT EXISTS saved_strategies (
  id         TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL,
  name       TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  preview    JSONB NOT NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_strategies_wallet ON saved_strategies(wallet);
