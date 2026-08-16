import { z } from "zod";

const apyEnvSchema = z.object({
  APY_DATABASE_URL: z.string().url(),
  APY_REDIS_URL: z.string().min(1),
  APY_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  APY_MAX_STALENESS_MS: z.coerce.number().int().positive().default(300_000),
  AAVE_POOL_BASE: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .default("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"),
});

export type ApyConfig = z.infer<typeof apyEnvSchema>;

export function loadApyConfig(
  env: Record<string, string | undefined> = process.env,
): ApyConfig {
  return apyEnvSchema.parse(env);
}
