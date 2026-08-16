-- Curated strategy catalog. Seeded once from a planner/build "simulation", then the
-- strategies poller refreshes only the rate-derived columns (net_apy, collateral_apy,
-- borrow_apy) from live market rates. The structural columns (leverage, tokens, market
-- key) are scale-invariant inputs to the net-APY formula, so they never need rebuilding.

CREATE TABLE IF NOT EXISTS strategy_catalog (
  id                TEXT PRIMARY KEY,        -- stable slug from the catalog
  chain_id          INTEGER NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  description       TEXT,                    -- human description from the build step
  leverage          NUMERIC,                 -- collateralValue / equity (scale-invariant)
  collateral_token  TEXT,                    -- collateral asset address (staking-rate key)
  borrow_market_key TEXT,                    -- Morpho market id (bytes32, borrow-rate key)
  snapshot          JSONB,                   -- per-leg structural snapshot (legs + idleCash)
  -- Rate-derived, refreshed by the poller:
  net_apy           NUMERIC,
  collateral_apy    NUMERIC,
  borrow_apy        NUMERIC,
  rate_status       TEXT NOT NULL DEFAULT 'unavailable', -- ok | unavailable
  seeded            BOOLEAN NOT NULL DEFAULT false,       -- structural build succeeded
  build_error       TEXT,                                 -- last seed failure, if any
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
