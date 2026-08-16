import type pg from "pg";
import type { StoredPosition } from "./types.js";

export async function upsertTrackedWallet(
  pool: pg.Pool,
  wallet: string,
  chainId: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO tracked_wallets (wallet, chain_id, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (wallet) DO UPDATE SET last_seen_at = NOW()`,
    [wallet.toLowerCase(), chainId],
  );
}

export async function getTrackedWallets(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query(`SELECT wallet FROM tracked_wallets`);
  return rows.map((r) => r.wallet as string);
}

export async function pruneStaleWallets(
  pool: pg.Pool,
  ttlDays: number,
): Promise<void> {
  await pool.query(
    `DELETE FROM tracked_wallets WHERE last_seen_at < NOW() - ($1 || ' days')::interval`,
    [String(ttlDays)],
  );
}

// Replaces a wallet's position set: upserts the current ones and removes any that
// no longer exist (e.g. fully closed). All amounts stored as text/NUMERIC.
export async function replaceWalletPositions(
  pool: pg.Pool,
  wallet: string,
  positions: StoredPosition[],
): Promise<void> {
  const w = wallet.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const keys = positions.map((p) => p.marketKey);
    if (keys.length > 0) {
      await client.query(
        `DELETE FROM user_positions WHERE wallet = $1 AND market_key <> ALL($2::text[])`,
        [w, keys],
      );
    } else {
      await client.query(`DELETE FROM user_positions WHERE wallet = $1`, [w]);
    }

    for (const p of positions) {
      await client.query(
        `INSERT INTO user_positions
           (wallet, market_key, collateral_token, loan_token, oracle, irm, lltv_wad,
            collateral, debt, collateral_value, ltv, lltv, net_apy, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
         ON CONFLICT (wallet, market_key) DO UPDATE SET
           collateral_token = $3, loan_token = $4, oracle = $5, irm = $6, lltv_wad = $7,
           collateral = $8, debt = $9, collateral_value = $10, ltv = $11, lltv = $12,
           net_apy = $13, updated_at = NOW()`,
        [
          w,
          p.marketKey,
          p.collateralToken,
          p.loanToken,
          p.oracle,
          p.irm,
          p.lltvWad,
          p.collateral,
          p.debt,
          p.collateralValue,
          p.ltv,
          p.lltv,
          p.netApy,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getWalletPositions(
  pool: pg.Pool,
  wallet: string,
): Promise<StoredPosition[]> {
  const { rows } = await pool.query(
    `SELECT wallet, market_key, collateral_token, loan_token, oracle, irm, lltv_wad,
            collateral, debt, collateral_value, ltv, lltv, net_apy, updated_at
     FROM user_positions WHERE wallet = $1`,
    [wallet.toLowerCase()],
  );
  return rows.map(rowToPosition);
}

// All positions across tracked wallets, grouped by wallet — lets the poller rebuild
// each market (oracle/irm/lltv persisted) and re-read on-chain without GraphQL.
export async function getAllPositionsByWallet(
  pool: pg.Pool,
): Promise<Map<string, StoredPosition[]>> {
  const { rows } = await pool.query(
    `SELECT wallet, market_key, collateral_token, loan_token, oracle, irm, lltv_wad,
            collateral, debt, collateral_value, ltv, lltv, net_apy, updated_at
     FROM user_positions`,
  );
  const byWallet = new Map<string, StoredPosition[]>();
  for (const r of rows) {
    const p = rowToPosition(r);
    const list = byWallet.get(p.wallet) ?? [];
    list.push(p);
    byWallet.set(p.wallet, list);
  }
  return byWallet;
}

function rowToPosition(r: any): StoredPosition {
  return {
    wallet: r.wallet,
    marketKey: r.market_key,
    collateralToken: r.collateral_token,
    loanToken: r.loan_token,
    oracle: r.oracle,
    irm: r.irm,
    lltvWad: r.lltv_wad,
    collateral: r.collateral,
    debt: r.debt,
    collateralValue: r.collateral_value,
    ltv: Number(r.ltv),
    lltv: Number(r.lltv),
    netApy: r.net_apy === null ? null : Number(r.net_apy),
    updatedAt: r.updated_at.toISOString(),
  };
}
