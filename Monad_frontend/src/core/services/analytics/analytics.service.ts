import type pg from "pg";
import { upsertUser, insertEvent, type AnalyticsEvent } from "./db.js";
import { getAdminMetrics, type AdminMetrics } from "./queries.js";

// Counting how many people use the app must never be able to stop them using it.
// Every method here swallows its own failures: a dead pool, a bad migration, a
// full disk — none of it should turn a sign-in or a plan into a 500. Losing a
// row of analytics is cheap; losing the request is not.
export class AnalyticsService {
  private readonly pool: pg.Pool;

  constructor(deps: { pool: pg.Pool }) {
    this.pool = deps.pool;
  }

  /** Called after a signature verifies. Creates the account row on first sign-in. */
  async recordSignIn(walletAddress: string, chainId?: number): Promise<void> {
    const wallet = walletAddress.toLowerCase();
    await this.safely("recordSignIn", async () => {
      await upsertUser(this.pool, wallet, chainId);
      await insertEvent(this.pool, wallet, "connected");
    });
  }

  /**
   * Records a funnel step. `walletAddress` may be null for signed-out activity —
   * the event still counts toward volume, it just can't be attributed to anyone.
   */
  async record(
    event: AnalyticsEvent,
    walletAddress: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const wallet = walletAddress ? walletAddress.toLowerCase() : null;
    await this.safely(event, () =>
      insertEvent(this.pool, wallet, event, meta),
    );
  }

  /**
   * Read side, for the admin dashboard. Unlike the write methods this one
   * throws: a dashboard that silently renders zeros when the query failed is
   * worse than one that says it's broken.
   */
  async getMetrics(): Promise<AdminMetrics> {
    return getAdminMetrics(this.pool);
  }

  private async safely(label: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.error(`[analytics] ${label} failed:`, err);
    }
  }
}
