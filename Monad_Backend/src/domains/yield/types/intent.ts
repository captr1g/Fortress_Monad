import { z } from "zod";
import { StrategyStepSchema } from "./strategy.js";
const hexAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const uint256String = z.string().regex(/^\d+$/);

const ProtocolAllocation = z.object({
  protocol: z.string().min(1),
  bps: z.number().int().min(1).max(10000),
  pendleMarket: z.string().optional(),
  aerodromePool: z.string().optional(),
});

// Deposit intent with action, amount and allocation(How much to which protocol)
const DepositIntent = z.object({
  action: z.literal("deposit"),
  amount: uint256String,
  allocations: z.array(ProtocolAllocation).min(1),
});

// Swap and deposit intent with action, amount and allocation and also minUsdcOut so as to revert if swap result less
const SwapAndDepositIntent = z.object({
  action: z.literal("swapAndDeposit"),
  inputToken: hexAddress,
  amount: uint256String,
  minUsdcOut: uint256String,
  allocations: z.array(ProtocolAllocation).min(1),
});

// Withdraw intent with action and entries(Which protocol to withdraw from and how much)
// amountType controls interpretation:
//   "shares"  — amount is raw share units (legacy, default)
//   "usdc"    — amount is USDC smallest units → converted to shares on-chain
//   "percent" — amount is 1–100 → percentage of user's share balance
//   "all"     — withdraw full balance (amount ignored)
const WithdrawAmountType = z
  .enum(["shares", "usdc", "percent", "all"])
  .default("shares");

const WithdrawIntent = z.object({
  action: z.literal("withdraw"),
  entries: z
    .array(
      z.object({
        protocol: z.string().min(1),
        shares: uint256String.optional().default("0"),
        amount: uint256String.optional(),
        amountType: WithdrawAmountType.optional(),
        pendleMarket: z.string().optional(),
        aerodromePool: z.string().optional(),
      }),
    )
    .min(1),
});

//  Rebalance intent with action and entries(From which protocol to which protocol and how much)
const RebalanceIntent = z.object({
  action: z.literal("rebalance"),
  entries: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        shares: uint256String,
      }),
    )
    .min(1),
});

// Bridge intent with action, amount and destination chain id
const BridgeIntent = z.object({
  action: z.literal("bridge"),
  amount: uint256String,
  destChainId: z.number().int().positive(),
});

// Claim withdraw intent with action and request id
const ClaimWithdrawIntent = z.object({
  action: z.literal("claimWithdraw"),
  requestId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

// Cancel withdraw intent with action and request id
const CancelWithdrawIntent = z.object({
  action: z.literal("cancelWithdraw"),
  requestId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

//  Refuse intent with action and reason
const RefuseIntent = z.object({
  action: z.literal("refuse"),
  reason: z.string().min(1),
});


const StrategyIntent = z.object({
  action: z.literal("strategy"),
  inputToken: hexAddress,
  inputAmount: uint256String,
  steps: z.array(StrategyStepSchema).min(1).max(30),
  targetLtv: z.number().min(0).max(1).optional(),
  loops: z.number().int().min(1).max(10).optional(),
});

// Open an exact-multiplier Morpho position via a flash loan.
// inputToken is the equity the user provides and must be the market's loan token;
// collateralToken is the asset to gain leveraged exposure to.
const LeverageIntent = z.object({
  action: z.literal("leverage"),
  inputToken: hexAddress,
  collateralToken: hexAddress,
  inputAmount: uint256String,
  multiplier: z.number().min(1).max(10),
  marketId: z.string().optional(),
});

//  All intents
export const IntentSchema = z.discriminatedUnion("action", [
  DepositIntent,
  SwapAndDepositIntent,
  WithdrawIntent,
  RebalanceIntent,
  BridgeIntent,
  ClaimWithdrawIntent,
  CancelWithdrawIntent,
  RefuseIntent,
  StrategyIntent,
  LeverageIntent,
]);

export type Intent = z.infer<typeof IntentSchema>;
export type DepositIntentType = z.infer<typeof DepositIntent>;
export type SwapAndDepositIntentType = z.infer<typeof SwapAndDepositIntent>;
export type WithdrawIntentType = z.infer<typeof WithdrawIntent>;
export type RebalanceIntentType = z.infer<typeof RebalanceIntent>;
export type BridgeIntentType = z.infer<typeof BridgeIntent>;
export type StrategyIntentType = z.infer<typeof StrategyIntent>;
export type LeverageIntentType = z.infer<typeof LeverageIntent>;

export function validateBpsSum(allocations: { bps: number }[]): boolean {
  return allocations.reduce((sum, a) => sum + a.bps, 0) === 10000;
}
