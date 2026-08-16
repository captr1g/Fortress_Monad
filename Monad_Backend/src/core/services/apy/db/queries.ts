import type pg from "pg";
import type { Market, MarketRates, StoredRates } from "../types.js";

// get enabled markets that we are currently fetching for
export async function getEnabledMarkets(pool: pg.Pool): Promise<Market[]> {
  const { rows } = await pool.query(
    `SELECT market_id, protocol, chain_id, name, reserve_address, market_key, enabled
     FROM market_registry WHERE enabled = true`
  );
  return rows.map((r) => ({
    marketId: r.market_id,
    protocol: r.protocol,
    chainId: r.chain_id,
    name: r.name,
    reserveAddress: r.reserve_address,
    marketKey: r.market_key,
    enabled: r.enabled,
  }));
}

// get all markets enabled + dissabled
export async function getAllMarkets(pool: pg.Pool): Promise<Market[]> {
  const { rows } = await pool.query(
    `SELECT market_id, protocol, chain_id, name, reserve_address, market_key, enabled
     FROM market_registry ORDER BY protocol, chain_id`
  );
  return rows.map((r) => ({
    marketId: r.market_id,
    protocol: r.protocol,
    chainId: r.chain_id,
    name: r.name,
    reserveAddress: r.reserve_address,
    marketKey: r.market_key,
    enabled: r.enabled,
  }));
}

// upsert rates of the market cleanly
export async function upsertRates(
  pool: pg.Pool,
  marketId: string,
  rates: MarketRates
): Promise<void> {
  await pool.query(
    `INSERT INTO market_rates (market_id, supply_apy, borrow_apy, rewards_apy, polled_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (market_id)
     DO UPDATE SET supply_apy = $2, borrow_apy = $3, rewards_apy = $4, polled_at = NOW()`,
    [marketId, rates.supplyApy, rates.borrowApy, rates.rewardsApy]
  );
}

// get rates for the market
export async function getRates(pool: pg.Pool, marketId: string): Promise<StoredRates | null> {
  const { rows } = await pool.query(
    `SELECT supply_apy, borrow_apy, rewards_apy, polled_at FROM market_rates WHERE market_id = $1`,
    [marketId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    supplyApy: parseFloat(r.supply_apy),
    borrowApy: r.borrow_apy ? parseFloat(r.borrow_apy) : null,
    rewardsApy: r.rewards_apy ? parseFloat(r.rewards_apy) : null,
    updatedAt: r.polled_at.toISOString(),
  };
}

function rowToMarket(r: any): Market {
  return {
    marketId: r.market_id,
    protocol: r.protocol,
    chainId: r.chain_id,
    name: r.name,
    reserveAddress: r.reserve_address,
    marketKey: r.market_key,
    enabled: r.enabled,
  };
}

export async function getMarketByKey(
  pool: pg.Pool,
  protocol: string,
  chainId: number,
  marketKey: string,
): Promise<Market | null> {
  const { rows } = await pool.query(
    `SELECT market_id, protocol, chain_id, name, reserve_address, market_key, enabled
     FROM market_registry
     WHERE protocol = $1 AND chain_id = $2 AND lower(market_key) = lower($3)`,
    [protocol, chainId, marketKey],
  );
  return rows.length ? rowToMarket(rows[0]) : null;
}

export async function getMarketByReserve(
  pool: pg.Pool,
  protocol: string,
  chainId: number,
  reserveAddress: string,
): Promise<Market | null> {
  const { rows } = await pool.query(
    `SELECT market_id, protocol, chain_id, name, reserve_address, market_key, enabled
     FROM market_registry
     WHERE protocol = $1 AND chain_id = $2 AND lower(reserve_address) = lower($3)`,
    [protocol, chainId, reserveAddress],
  );
  return rows.length ? rowToMarket(rows[0]) : null;
}

export async function insertMarket(pool: pg.Pool, market: Market): Promise<void> {
  await pool.query(
    `INSERT INTO market_registry (market_id, protocol, chain_id, name, reserve_address, market_key, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT (market_id) DO NOTHING`,
    [
      market.marketId,
      market.protocol,
      market.chainId,
      market.name,
      market.reserveAddress,
      market.marketKey,
    ],
  );
}
