import type pg from "pg";

export type SavedStrategyRow = {
  id: string;
  wallet: string;
  name: string;
  prompt: string;
  preview: unknown;
  savedAt: string;
  renamedAt: string | null;
  lastUsedAt: string | null;
};

const SELECT_COLUMNS =
  "id, wallet, name, prompt, preview, saved_at, renamed_at, last_used_at";

export async function insertSavedStrategy(
  pool: pg.Pool,
  entry: {
    id: string;
    wallet: string;
    name: string;
    prompt: string;
    preview: unknown;
  },
): Promise<SavedStrategyRow> {
  const { rows } = await pool.query(
    `INSERT INTO saved_strategies (id, wallet, name, prompt, preview)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SELECT_COLUMNS}`,
    [
      entry.id,
      entry.wallet,
      entry.name,
      entry.prompt,
      JSON.stringify(entry.preview),
    ],
  );
  return rowToSavedStrategy(rows[0]);
}

export async function listSavedStrategies(
  pool: pg.Pool,
  wallet: string,
): Promise<SavedStrategyRow[]> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS}
     FROM saved_strategies WHERE wallet = $1 ORDER BY saved_at DESC`,
    [wallet],
  );
  return rows.map(rowToSavedStrategy);
}

export async function countForWallet(
  pool: pg.Pool,
  wallet: string,
): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM saved_strategies WHERE wallet = $1`,
    [wallet],
  );
  return rows[0].count;
}

// Scoped by wallet so a delete can't remove another wallet's row. Returns whether a
// row was actually deleted (false means not found or not owned by this wallet).
export async function deleteSavedStrategy(
  pool: pg.Pool,
  id: string,
  wallet: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM saved_strategies WHERE id = $1 AND wallet = $2`,
    [id, wallet],
  );
  return (rowCount ?? 0) > 0;
}

// Scoped by wallet, same ownership rule as delete. Returns the updated row, or
// null if not found / not owned by this wallet.
export async function renameSavedStrategy(
  pool: pg.Pool,
  id: string,
  wallet: string,
  name: string,
): Promise<SavedStrategyRow | null> {
  const { rows } = await pool.query(
    `UPDATE saved_strategies SET name = $3, renamed_at = NOW() WHERE id = $1 AND wallet = $2
     RETURNING ${SELECT_COLUMNS}`,
    [id, wallet, name],
  );
  return rows[0] ? rowToSavedStrategy(rows[0]) : null;
}

// Scoped by wallet, same ownership rule as delete/rename. Called whenever the
// user regenerates a saved strategy from the composer ("Edit & Regenerate").
export async function touchSavedStrategyUsage(
  pool: pg.Pool,
  id: string,
  wallet: string,
): Promise<SavedStrategyRow | null> {
  const { rows } = await pool.query(
    `UPDATE saved_strategies SET last_used_at = NOW() WHERE id = $1 AND wallet = $2
     RETURNING ${SELECT_COLUMNS}`,
    [id, wallet],
  );
  return rows[0] ? rowToSavedStrategy(rows[0]) : null;
}

function rowToSavedStrategy(r: any): SavedStrategyRow {
  return {
    id: r.id,
    wallet: r.wallet,
    name: r.name,
    prompt: r.prompt,
    preview: r.preview,
    savedAt: r.saved_at.toISOString(),
    renamedAt: r.renamed_at ? r.renamed_at.toISOString() : null,
    lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  };
}
