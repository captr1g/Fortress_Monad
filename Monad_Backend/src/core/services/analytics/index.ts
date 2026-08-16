import { z } from "zod";
import { getPool } from "../apy/db/client.js";
import { AnalyticsService } from "./analytics.service.js";
import { ensureAnalyticsSchema } from "./db.js";

const analyticsEnvSchema = z.object({
  APY_DATABASE_URL: z.string().url(),
});

/**
 * Starts analytics, or returns undefined if its schema can't be created.
 *
 * No secret gates this. An earlier version hashed wallets behind a pepper, but
 * tracked_wallets/user_positions/saved_strategies already store raw addresses
 * in this same database — hashing only the analytics tables didn't stop
 * anyone with DB access from reading them, it only blocked joining "who saved
 * a strategy" against "who deployed one". Privacy here comes from a
 * read-only Postgres role scoped to the views in db.ts, not from the schema.
 */
export async function startAnalyticsService(): Promise<
  AnalyticsService | undefined
> {
  const config = analyticsEnvSchema.parse(process.env);
  const pool = getPool(config.APY_DATABASE_URL);

  // Analytics is bookkeeping. If its schema can't be created, that is a reason
  // to have no analytics — not a reason to take the whole API down and stop
  // users from building strategies. Boot continues with analytics disabled.
  try {
    await ensureAnalyticsSchema(pool);
  } catch (err) {
    console.error(
      "[analytics] schema setup failed — analytics disabled for this process:",
      err,
    );
    return undefined;
  }

  console.log("[analytics] Started");
  return new AnalyticsService({ pool });
}

export { AnalyticsService } from "./analytics.service.js";
export type { AnalyticsEvent } from "./db.js";
