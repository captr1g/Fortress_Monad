import type pg from "pg";

export type FunnelTotals = {
  connected: number;
  generated: number;
  saved: number;
  deployed: number;
};

export type DailyFunnelRow = { day: string } & FunnelTotals;

export type CohortRow = {
  cohortWeek: string;
  wallets: number;
  returned: number;
  active30d: number;
};

export type MetricsSummary = {
  wallets: number;
  newLast7d: number;
  newLast30d: number;
  active30d: number;
  returning: number;
};

export type AdminMetrics = {
  summary: MetricsSummary;
  funnel30d: FunnelTotals;
  daily: DailyFunnelRow[];
  cohorts: CohortRow[];
  generatedAt: string;
};

export async function getAdminMetrics(pool: pg.Pool): Promise<AdminMetrics> {
  const [summary, funnel30d, daily, cohorts] = await Promise.all([
    getSummary(pool),
    getFunnelTotals(pool, 30),
    getDaily(pool, 30),
    getCohorts(pool, 12),
  ]);

  return { summary, funnel30d, daily, cohorts, generatedAt: new Date().toISOString() };
}

async function getSummary(pool: pg.Pool): Promise<MetricsSummary> {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                                             AS wallets,
      COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '7 days')    AS new_last_7d,
      COUNT(*) FILTER (WHERE first_seen_at > NOW() - INTERVAL '30 days')   AS new_last_30d,
      COUNT(*) FILTER (WHERE last_seen_at  > NOW() - INTERVAL '30 days')   AS active_30d,
      COUNT(*) FILTER (WHERE login_count > 1)                              AS returning
    FROM app_user
  `);
  const r = rows[0];
  return {
    wallets: Number(r.wallets),
    newLast7d: Number(r.new_last_7d),
    newLast30d: Number(r.new_last_30d),
    active30d: Number(r.active_30d),
    returning: Number(r.returning),
  };
}

// Distinct users per step across the whole window. Deliberately NOT a sum of the
// daily view: someone who connects on Monday and again on Friday is one person
// for the month but appears in two daily rows, so summing would overcount.
async function getFunnelTotals(
  pool: pg.Pool,
  days: number,
): Promise<FunnelTotals> {
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'connected')       AS connected,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'plan_generated')  AS generated,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'strategy_saved')  AS saved,
      COUNT(DISTINCT wallet) FILTER (WHERE event = 'position_opened') AS deployed
    FROM user_event
    WHERE ts > NOW() - ($1 || ' days')::interval
  `,
    [String(days)],
  );
  return toFunnel(rows[0]);
}

async function getDaily(pool: pg.Pool, days: number): Promise<DailyFunnelRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM daily_funnel WHERE day > NOW() - ($1 || ' days')::interval ORDER BY day ASC`,
    [String(days)],
  );
  return rows.map((r) => ({
    day: (r.day as Date).toISOString(),
    ...toFunnel(r),
  }));
}

async function getCohorts(pool: pg.Pool, weeks: number): Promise<CohortRow[]> {
  const { rows } = await pool.query(
    `SELECT * FROM user_cohorts LIMIT $1`,
    [weeks],
  );
  return rows.map((r) => ({
    cohortWeek: (r.cohort_week as Date).toISOString(),
    wallets: Number(r.wallets),
    returned: Number(r.returned),
    active30d: Number(r.active_30d),
  }));
}

// COUNT() comes back from pg as a string (bigint), and NULL when no rows matched.
function toFunnel(r: Record<string, unknown>): FunnelTotals {
  return {
    connected: Number(r.connected ?? 0),
    generated: Number(r.generated ?? 0),
    saved: Number(r.saved ?? 0),
    deployed: Number(r.deployed ?? 0),
  };
}
