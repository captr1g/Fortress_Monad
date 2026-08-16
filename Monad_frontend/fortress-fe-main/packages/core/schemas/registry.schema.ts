import { z } from "zod";

// Mirrors prompt_2_defi's GET /fortress/registry — the canonical chain/token/
// market data both frontends render pickers and chips from.
export const RegistryTokenSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  address: z.string(),
  decimals: z.number(),
  stable: z.boolean().optional(),
  inputEnabled: z.boolean().optional(),
});

export const RegistryMarketSchema = z.object({
  label: z.string(),
  collateral: z.string(),
  loan: z.string(),
});

// Which vault/market a protocol actually resolves to, and which app-level
// actions apply to it — only populated for the chain the backend can
// currently resolve protocol config for (Base today).
export const RegistryProtocolSchema = z.object({
  name: z.string(),
  vaultSymbol: z.string().optional(),
  kind: z.enum(["variable", "fixed", "routing"]),
  pendleMarkets: z.array(z.object({ label: z.string(), market: z.string() })).optional(),
  actions: z.array(z.enum(["Deposit", "Leverage", "Swap"])),
});

export const RegistryChainSchema = z.object({
  chainId: z.number(),
  label: z.string(),
  executable: z.boolean(),
  loanToken: z.string(),
  tokens: z.array(RegistryTokenSchema),
  markets: z.array(RegistryMarketSchema),
  protocols: z.array(RegistryProtocolSchema).optional(),
});

export const RegistryResponseSchema = z.object({
  chains: z.array(RegistryChainSchema),
});
