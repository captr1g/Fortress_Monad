import type pg from "pg";
import type { StrategySnapshot } from "../apy/types.js";

// Persisted catalog row. Structural fields (leverage, tokens, market key, snapshot) are
// seeded once from a build; rate fields are refreshed by the poller from live rates.
export type StoredStrategy = {
  id: string;
  chainId: number;
  title: string;
  summary: string;
  prompt: string;
  description: string | null;
  leverage: number | null;
  collateralToken: string | null;
  borrowMarketKey: string | null;
  snapshot: StrategySnapshot | null;
  netApy: number | null;
  collateralApy: number | null;
  borrowApy: number | null;
  rateStatus: "ok" | "unavailable";
  seeded: boolean;
  buildError: string | null;
  updatedAt: string;
};

// Inserts catalog metadata (title/summary/prompt) without touching computed columns,
// so re-seeding never clobbers fresh rates. Run once at startup per catalog entry.
export async function upsertCatalogMeta(
  pool: pg.Pool,
  entry: {
    id: string;
    chainId: number;
    title: string;
    summary: string;
    prompt: string;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO strategy_catalog (id, chain_id, title, summary, prompt)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       chain_id = $2, title = $3, summary = $4, prompt = $5, updated_at = NOW()`,
    [entry.id, entry.chainId, entry.title, entry.summary, entry.prompt],
  );
}

// Persists the one-time structural build result: leverage, rate-resolution keys, and the
// full per-leg snapshot (JSON) the poller re-prices from live rates.
export async function saveStrategyBuild(
  pool: pg.Pool,
  build: {
    id: string;
    description: string | null;
    leverage: number | null;
    collateralToken: string | null;
    borrowMarketKey: string | null;
    snapshot: StrategySnapshot | null;
  },
): Promise<void> {
  await pool.query(
    `UPDATE strategy_catalog SET
       description = $2, leverage = $3, collateral_token = $4, borrow_market_key = $5,
       snapshot = $6, seeded = true, build_error = NULL, updated_at = NOW()
     WHERE id = $1`,
    [
      build.id,
      build.description,
      build.leverage,
      build.collateralToken,
      build.borrowMarketKey,
      build.snapshot ? JSON.stringify(build.snapshot) : null,
    ],
  );
}

export async function saveStrategyBuildError(
  pool: pg.Pool,
  id: string,
  error: string,
): Promise<void> {
  await pool.query(
    `UPDATE strategy_catalog SET build_error = $2, seeded = false, updated_at = NOW() WHERE id = $1`,
    [id, error],
  );
}

// Refreshes only the rate-derived columns (net APY + display rates) plus leverage, which
// the poller recomputes from the snapshot each cycle (leverage is rate-independent but
// re-stored so a schema-fresh row converges).
export async function saveStrategyRates(
  pool: pg.Pool,
  rates: {
    id: string;
    netApy: number | null;
    collateralApy: number | null;
    borrowApy: number | null;
    leverage: number | null;
    rateStatus: "ok" | "unavailable";
  },
): Promise<void> {
  await pool.query(
    `UPDATE strategy_catalog SET
       net_apy = $2, collateral_apy = $3, borrow_apy = $4, leverage = $5,
       rate_status = $6, updated_at = NOW()
     WHERE id = $1`,
    [
      rates.id,
      rates.netApy,
      rates.collateralApy,
      rates.borrowApy,
      rates.leverage,
      rates.rateStatus,
    ],
  );
}

export async function getAllStrategies(
  pool: pg.Pool,
): Promise<StoredStrategy[]> {
  const { rows } = await pool.query(
    `SELECT id, chain_id, title, summary, prompt, description, leverage,
            collateral_token, borrow_market_key, snapshot, net_apy, collateral_apy,
            borrow_apy, rate_status, seeded, build_error, updated_at
     FROM strategy_catalog ORDER BY created_at ASC`,
  );
  return rows.map(rowToStrategy);
}

// Strategies that have been structurally seeded and carry a snapshot — the only ones the
// rate poller can re-price.
export async function getSeededStrategies(
  pool: pg.Pool,
): Promise<StoredStrategy[]> {
  const { rows } = await pool.query(
    `SELECT id, chain_id, title, summary, prompt, description, leverage,
            collateral_token, borrow_market_key, snapshot, net_apy, collateral_apy,
            borrow_apy, rate_status, seeded, build_error, updated_at
     FROM strategy_catalog WHERE seeded = true AND snapshot IS NOT NULL`,
  );
  return rows.map(rowToStrategy);
}

function rowToStrategy(r: any): StoredStrategy {
  return {
    id: r.id,
    chainId: r.chain_id,
    title: r.title,
    summary: r.summary,
    prompt: r.prompt,
    description: r.description,
    leverage: r.leverage === null ? null : Number(r.leverage),
    collateralToken: r.collateral_token,
    borrowMarketKey: r.borrow_market_key,
    snapshot: parseSnapshot(r.snapshot),
    netApy: r.net_apy === null ? null : Number(r.net_apy),
    collateralApy: r.collateral_apy === null ? null : Number(r.collateral_apy),
    borrowApy: r.borrow_apy === null ? null : Number(r.borrow_apy),
    rateStatus: r.rate_status,
    seeded: r.seeded,
    buildError: r.build_error,
    updatedAt: r.updated_at.toISOString(),
  };
}

// snapshot is stored as jsonb; pg returns it already-parsed for jsonb, but tolerate text.
function parseSnapshot(raw: unknown): StrategySnapshot | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as StrategySnapshot;
    } catch {
      return null;
    }
  }
  return raw as StrategySnapshot;
}
