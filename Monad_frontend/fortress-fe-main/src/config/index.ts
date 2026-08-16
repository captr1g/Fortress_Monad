import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o"),
  TENDERLY_ACCESS_KEY: z.string().min(1),
  TENDERLY_ACCOUNT_SLUG: z.string().min(1),
  TENDERLY_PROJECT_SLUG: z.string().min(1),
  RPC_BASE: z.string().url(),
  RPC_ETH: z.string().optional().default(""),
  RPC_ARB: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppConfig = {
  openai: { apiKey: string; model: string };
  tenderly: { accessKey: string; accountSlug: string; projectSlug: string };
  rpc: { base: string; eth: string; arb: string };
  server: { port: number };
};

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    openai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL,
    },
    tenderly: {
      accessKey: parsed.TENDERLY_ACCESS_KEY,
      accountSlug: parsed.TENDERLY_ACCOUNT_SLUG,
      projectSlug: parsed.TENDERLY_PROJECT_SLUG,
    },
    rpc: {
      base: parsed.RPC_BASE,
      eth: parsed.RPC_ETH,
      arb: parsed.RPC_ARB,
    },
    server: {
      port: parsed.PORT,
    },
  };
}

export const config = loadConfig();
