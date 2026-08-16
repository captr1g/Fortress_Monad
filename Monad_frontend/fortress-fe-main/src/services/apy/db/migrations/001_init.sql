CREATE TYPE protocol_type AS ENUM ('aave', 'morpho');

CREATE TABLE market_registry (
  market_id       TEXT PRIMARY KEY,
  protocol        protocol_type NOT NULL,
  chain_id        INTEGER NOT NULL,
  name            TEXT NOT NULL,
  reserve_address TEXT,
  market_key      TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE market_rates (
  market_id   TEXT PRIMARY KEY REFERENCES market_registry(market_id),
  supply_apy  NUMERIC NOT NULL,
  borrow_apy  NUMERIC,
  rewards_apy NUMERIC,
  polled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_market_registry_enabled ON market_registry(enabled) WHERE enabled = true;
CREATE INDEX idx_market_registry_protocol_chain ON market_registry(protocol, chain_id) WHERE enabled = true;
