import { z } from "zod";
import type { EvmTransaction, EvmChainConfig } from "@chains/evm/types.js";
import type { MorphoMarketParams, ExistingMarketPosition } from "./market.js";
const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const uint256String = z.string().regex(/^\d+$/);

// For optional uint256 fields where the LLM may emit "" instead of omitting the key
const optionalUint256 = z
  .string()
  .optional()
  .transform((v) => (v === "" || v === undefined ? undefined : v))
  .pipe(uint256String.optional());

export const StrategyStepSchema = z.object({
  action: z.enum([
    "swap",
    "swapToPt",
    "swapToYt",
    "addLiquidityPendle",
    "wrapLp",
    "supplyCollateral",
    "borrow",
    "repay",
    "withdrawCollateral",
  ]),
  tokenIn: hexAddress,
  tokenOut: hexAddress.optional(),
  bps: z.number().int().min(0).max(10000).default(10000),
  amountFixed: optionalUint256,
  protocolData: z
    .object({
      marketId: z.string().optional(),
      pendleMarket: z.string().optional(),
      borrowAmount: optionalUint256,
      withdrawAmount: optionalUint256,
      targetLtv: z.number().min(0).max(1).optional(),
      borrowCeiling: optionalUint256,
      useFullBalance: z.boolean().optional(),
      dex: hexAddress.optional(),
      minAmountOut: optionalUint256,
      slippage: z.number().min(0).max(0.5).optional(),
    })
    .optional(),
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

export type StrategyBuildResult = {
  transactions: EvmTransaction[];
  description: string;
  setupTxs: EvmTransaction[];
  projection: {
    collateral: Map<string, bigint>;
    debt: Map<string, bigint>;
    balances: Map<string, bigint>;
  };
};

export type StrategyBuildContext = {
  walletAddress: `0x${string}`;
  config: EvmChainConfig;
  morphoMarkets: Map<string, MorphoMarketParams>;
  oraclePrices: Map<string, bigint>; // Live oracle price
  existingPositions?: Map<string, ExistingMarketPosition>; // Existing Position
  // Net input the executor actually has after skimming its input fee. Used to
  // seed the balance projection so baked swap amounts match on-chain. The
  // executeStrategy arg + approval still use the gross intent.inputAmount, since
  // the executor pulls gross from the user before skimming. Defaults to
  // intent.inputAmount when the fee is 0 or unset.
  netInputAmount?: bigint;
  fetchSwapCalldata: (params: {
    fromToken: `0x${string}`;
    toToken: `0x${string}`;
    fromAmount: bigint;
    fromAddress: `0x${string}`;
    slippage: number;
  }) => Promise<{
    dex: `0x${string}`;
    calldata: `0x${string}`;
    expectedOut: bigint;
  }>;
  fetchPendleCalldata: (params: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    fromAmount: bigint;
    slippage: number;
  }) => Promise<{
    calldata: `0x${string}`;
    expectedOut: bigint;
  }>;
};
