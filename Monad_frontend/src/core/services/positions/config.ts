import { z } from "zod";

const positionsEnvSchema = z.object({
  APY_DATABASE_URL: z.string().url(),
  APY_REDIS_URL: z.string().min(1),
  RPC_BASE: z.string().url(),
  POSITIONS_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30_000),
  POSITIONS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  POSITIONS_STALE_MS: z.coerce.number().int().positive().default(60_000),
  POSITIONS_WALLET_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type PositionsConfig = z.infer<typeof positionsEnvSchema>;

export function loadPositionsConfig(
  env: Record<string, string | undefined> = process.env,
): PositionsConfig {
  return positionsEnvSchema.parse(env);
}
