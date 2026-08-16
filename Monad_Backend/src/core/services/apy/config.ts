import { z } from "zod";

const apyEnvSchema = z.object({
  APY_DATABASE_URL: z.string().url(),
  APY_REDIS_URL: z.string().min(1),
  APY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  APY_MAX_STALENESS_MS: z.coerce.number().int().positive().default(300_000),
  // Aave V3 Monad Pool. Verified live: getMarketId() == "Aave V3 Monad", and
  // the Pool's own ADDRESSES_PROVIDER().getPool() closes the loop back to it
  // (ADDRESSES.md §5.4). Neverland is the other Aave V3 market on Monad; it is
  // driven through the per-protocol `aavePool` in the chain config, not here,
  // because this map holds at most one pool per chain id.
  AAVE_POOL_MONAD: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef"),
});

export type ApyConfig = z.infer<typeof apyEnvSchema>;

export function loadApyConfig(
  env: Record<string, string | undefined> = process.env,
): ApyConfig {
  return apyEnvSchema.parse(env);
}
