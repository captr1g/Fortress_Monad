import { z } from "zod";

const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const uint256String = z.string().regex(/^\d+$/);

// For optional uint256 fields where the LLM may emit "" instead of omitting the key
const optionalUint256 = z.string().optional().transform((v) => (v === "" || v === undefined ? undefined : v))
  .pipe(uint256String.optional());

export const StrategyStepSchema = z.object({
  action: z.enum(["swap", "supplyCollateral", "borrow", "repay", "withdrawCollateral"]),
  tokenIn: hexAddress,
  tokenOut: hexAddress.optional(),
  bps: z.number().int().min(0).max(10000).default(10000),
  amountFixed: optionalUint256,
  protocolData: z.object({
    marketId: z.string().optional(),
    borrowAmount: optionalUint256,
    withdrawAmount: optionalUint256,
    dex: hexAddress.optional(),
    minAmountOut: optionalUint256,
    slippage: z.number().min(0).max(0.5).optional(),
  }).optional(),
});

export const StrategyIntentSchema = z.object({
  action: z.literal("strategy"),
  inputToken: hexAddress,
  inputAmount: uint256String,
  steps: z.array(StrategyStepSchema).min(1).max(30),
  targetLtv: z.number().min(0).max(1).optional(),
  loops: z.number().int().min(1).max(10).optional(),
});

export type StrategyStep = z.infer<typeof StrategyStepSchema>;
export type StrategyIntent = z.infer<typeof StrategyIntentSchema>;
