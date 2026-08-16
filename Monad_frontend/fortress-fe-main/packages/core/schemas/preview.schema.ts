import { z } from "zod";

// Response schemas mirror prompt_2_defi/src/core/types.ts.
// NOTE: the backend serializes every bigint to a string (preSerialization hook),
// so all on-chain amounts arrive as strings, not numbers.

export const BalanceChangeSchema = z.object({
  token: z.string(),
  tokenAddress: z.string(),
  before: z.string(),
  after: z.string(),
  decimals: z.number().optional(),
  symbol: z.string().optional(),
  logoURI: z.string().optional(),
});

export const PositionStateSchema = z.object({
  collateral: z.string(),
  debt: z.string(),
  ltv: z.number(),
  lltv: z.number(),
});

export const TokenAmountSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  decimals: z.number(),
  amount: z.string(),
  logoURI: z.string().optional(),
});

// Display action labels. The last four are Pendle-specific (prompt_2_defi's
// StrategyIntent.steps[].action enum added swapToPt/swapToYt/
// addLiquidityPendle/wrapLp), and Repay/Withdraw are split out from the
// generic "Supply" label they used to share with supplyCollateral — repaying
// debt or withdrawing collateral is the opposite of supplying it.
export const StrategyStepSchema = z.object({
  index: z.number(),
  toolId: z.string(),
  action: z.enum([
    "Swap",
    "Bridge",
    "Lend",
    "Supply",
    "Borrow",
    "Repay",
    "Withdraw",
    "Stake",
    "Deposit",
    "Claim",
    "Swap to PT",
    "Swap to YT",
    "Add Liquidity",
    "Wrap LP",
    "Open Leverage",
  ]),
  venue: z.string(),
  // The specific Morpho market this step resolved to (e.g. "cbETH-USDC"),
  // when the step is a supplyCollateral/borrow/repay/withdrawCollateral on
  // a protocol with multiple markets. Absent for plain deposit (single
  // vault, no market to disambiguate) and swap/bridge steps.
  market: z.string().optional(),
  chainId: z.number(),
  tokenIn: TokenAmountSchema.optional(),
  tokenOut: TokenAmountSchema.optional(),
  apy: z.object({ value: z.number(), kind: z.enum(["yield", "cost"]) }).optional(),
  position: PositionStateSchema.optional(),
});

export const SimResultSchema = z.object({
  success: z.boolean(),
  revertReason: z.string().optional(),
  revertIndex: z.number().optional(),
  gasUsed: z.string(),
  gasCostNative: z.string(),
  balanceChanges: z.array(BalanceChangeSchema),
  positionAfter: PositionStateSchema.optional(),
  rawLogs: z.array(z.unknown()),
});

export const PreviewCardSchema = z.object({
  summary: z.string(),
  balanceChanges: z.array(BalanceChangeSchema),
  gasEstimate: z.object({ gasUnits: z.string(), nativeCost: z.string() }),
  position: PositionStateSchema.optional(),
});

export const UnsignedTxSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.string(),
  chainId: z.number(),
});

export const ExecutionArtifactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("approval"),
    chainId: z.number(),
    tx: UnsignedTxSchema,
    tokenAddress: z.string(),
    spender: z.string(),
    amount: z.string(),
  }),
  z.object({ kind: z.literal("evmTx"), chainId: z.number(), tx: UnsignedTxSchema }),
  z.object({ kind: z.literal("evmBundle"), chainId: z.number(), tx: UnsignedTxSchema }),
  z.object({ kind: z.literal("signedAction"), venue: z.string(), typedData: z.unknown() }),
]);

// APY breakdown attached to the Preview after the API response is adapted.
// The legacy /fortress/plan response includes a top-level `apy` object with
// per-step breakdown and aggregate metrics.
export const ApyStepSchema = z.object({
  index: z.number(),
  action: z.string(),
  apy: z.number().nullable(),
  kind: z.enum(["earn", "cost", "neutral"]),
  status: z.string(),
  token: z.string().optional(),
});

// value fields are nullable — the backend's ApyTerm carries `value: number |
// null` (status "unavailable" ships with a null value, not an omitted key).
export const PreviewApySchema = z.object({
  status: z.string(),
  asOf: z.string().optional(),
  leverage: z.number().optional(),
  baseApy: z.number().nullable().optional(),
  netApy: z.object({ value: z.number().nullable(), status: z.string() }).optional(),
  collateralApy: z
    .object({ value: z.number().nullable(), status: z.string(), source: z.string(), token: z.string().optional() })
    .optional(),
  borrowApy: z
    .object({ value: z.number().nullable(), status: z.string(), source: z.string(), market: z.string().optional() })
    .optional(),
  steps: z.array(ApyStepSchema).optional(),
});

// A flat "deposit $X, split across protocols by allocation %" plan — the
// backend's `deposit`/`swapAndDeposit` intents. No ordered steps, so the
// step visualizer has nothing to walk; the UI renders this block instead.
export const AllocationLegSchema = z.object({
  protocol: z.string(),
  bps: z.number(),
  apy: z.number().nullable().optional(),
  status: z.string().optional(),
  // The specific underlying vault/wrapper token this leg deposits into (e.g.
  // "mwUSDC" for Morpho, or a Pendle market label like "40acresUSDC") — the
  // protocol name alone is a brand, not the contract holding the funds.
  market: z.string().optional(),
  // On-chain address behind `market`, shown on hover for verification.
  marketAddress: z.string().optional(),
});
export const DepositAllocationSchema = z.object({
  token: z.string(),
  tokenAddress: z.string().optional(),
  decimals: z.number().optional(),
  amount: z.string(),
  legs: z.array(AllocationLegSchema),
});

// The plan's input token + raw-unit amount — powers the Amount field on the
// result screens (prefill + unit conversion).
export const PlanInputSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  decimals: z.number(),
  amount: z.string(), // raw base units
});

// Only present for swapAndDeposit intents whose starting asset can be
// looped through Morpho, and only when looping it projects to a real,
// clearly-better net APY than the plan already being shown, never a
// marginal or fabricated one.
export const LoopSuggestionSchema = z.object({
  label: z.string(),
  insertText: z.string(),
  currentApy: z.number(),
  projectedApy: z.number(),
  leverage: z.number(),
});

export const PreviewSchema = z.object({
  planId: z.string(),
  humanSummary: z.string(),
  simulation: SimResultSchema,
  artifacts: z.array(ExecutionArtifactSchema),
  previewCards: z.array(PreviewCardSchema),
  steps: z.array(StrategyStepSchema).optional(),
  allocations: DepositAllocationSchema.optional(),
  netApy: z.number().optional(),
  leverage: z.number().optional(),
  apy: PreviewApySchema.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  input: PlanInputSchema.optional(),
  loopSuggestion: LoopSuggestionSchema.optional(),
  // The backend intent, passed back verbatim on POST /fortress/simulate.
  // Deliberately opaque to the frontend.
  rawIntent: z.unknown().optional(),
});

export const ValidateResponseSchema = z.object({
  valid: z.boolean(),
  planId: z.string(),
});

export const ExecuteResponseSchema = z.object({
  planId: z.string(),
  artifacts: z.array(ExecutionArtifactSchema),
});

// A recovery hint attached to a failed generation. `insertText` present means
// the UI renders a tappable chip that appends that line to the prompt.
export const SuggestionSchema = z.object({
  label: z.string(),
  insertText: z.string().optional(),
});

export const ApiErrorSchema = z.object({
  error: z.object({
    stage: z.string(),
    // The real backend's plan errors carry no category — optional so the
    // parse succeeds and the actual message/suggestions survive.
    category: z.string().optional(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    suggestions: z.array(SuggestionSchema).optional(),
  }),
});
