CREATE TABLE IF NOT EXISTS tracked_wallets (
  wallet       TEXT PRIMARY KEY,
  chain_id     INTEGER NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_positions (
  wallet           TEXT NOT NULL,
  market_key       TEXT NOT NULL,
  collateral_token TEXT NOT NULL,
  loan_token       TEXT NOT NULL,
  oracle           TEXT NOT NULL,
  irm              TEXT NOT NULL,
  lltv_wad         NUMERIC NOT NULL,
  collateral       NUMERIC NOT NULL,
  debt             NUMERIC NOT NULL,
  collateral_value NUMERIC NOT NULL,
  ltv              DOUBLE PRECISION NOT NULL,
  lltv             DOUBLE PRECISION NOT NULL,
  net_apy          DOUBLE PRECISION,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (wallet, market_key)
);

CREATE INDEX IF NOT EXISTS idx_user_positions_wallet ON user_positions(wallet);
CREATE INDEX IF NOT EXISTS idx_tracked_wallets_last_seen ON tracked_wallets(last_seen_at);
