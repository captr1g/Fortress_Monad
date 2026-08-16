import { z } from "zod";

// Mirrors prompt_2_defi's GET /fortress/positions response.
export const PositionApiSchema = z.object({
  wallet: z.string(),
  marketKey: z.string(),
  collateralToken: z.string(),
  loanToken: z.string(),
  oracle: z.string(),
  irm: z.string(),
  lltvWad: z.string(),
  collateral: z.string(),
  debt: z.string(),
  collateralValue: z.string(), // raw units of loanToken (USDC = 6dp)
  ltv: z.number(),             // e.g. 0.469
  lltv: z.number(),            // e.g. 0.86
  netApy: z.number(),          // e.g. 0.0106 (fraction, not percent)
  updatedAt: z.string(),
});

export const PositionsResponseSchema = z.object({
  positions: z.array(PositionApiSchema),
  asOf: z.string().nullable(), // null before the cache has ever been populated
  stale: z.boolean(),
});
