// Factory functions for production Intent objects (src/domains/yield/types/intent.ts).
// Each returns a valid-by-default object with overridable fields, so tests state
// only what matters to them.
import type {
  DepositIntentType,
  WithdrawIntentType,
  RebalanceIntentType,
  BridgeIntentType,
  StrategyIntentType,
  LeverageIntentType,
} from "@domains/yield/types/intent.js";
import { TOKENS, ONE_USDC } from "../datasets/base.js";

type Overrides<T> = Partial<T>;

export function makeDepositIntent(
  o: Overrides<DepositIntentType> = {},
): DepositIntentType {
  return {
    action: "deposit",
    amount: ONE_USDC.toString(),
    allocations: [{ protocol: "Morpho", bps: 10000 }],
    ...o,
  };
}

export function makeSplitDepositIntent(): DepositIntentType {
  return {
    action: "deposit",
    amount: ONE_USDC.toString(),
    allocations: [
      { protocol: "Morpho", bps: 5000 },
      { protocol: "Aave", bps: 5000 },
    ],
  };
}

export function makeWithdrawIntent(
  o: Overrides<WithdrawIntentType> = {},
): WithdrawIntentType {
  return {
    action: "withdraw",
    entries: [{ protocol: "Morpho", shares: "0", amountType: "all" }],
    ...o,
  };
}

export function makeRebalanceIntent(
  o: Overrides<RebalanceIntentType> = {},
): RebalanceIntentType {
  return {
    action: "rebalance",
    entries: [{ from: "Aave", to: "Morpho", shares: "1000000" }],
    ...o,
  };
}

export function makeBridgeIntent(
  o: Overrides<BridgeIntentType> = {},
): BridgeIntentType {
  return {
    action: "bridge",
    amount: ONE_USDC.toString(),
    destChainId: 42161,
    ...o,
  };
}

export function makeLeverageIntent(
  o: Overrides<LeverageIntentType> = {},
): LeverageIntentType {
  return {
    action: "leverage",
    inputToken: TOKENS.USDC,
    collateralToken: TOKENS.cbETH,
    inputAmount: ONE_USDC.toString(),
    multiplier: 2,
    marketId: "cbETH-USDC",
    ...o,
  };
}

// A minimal supply+borrow strategy on the cbETH-USDC market.
export function makeStrategyIntent(
  o: Overrides<StrategyIntentType> = {},
): StrategyIntentType {
  return {
    action: "strategy",
    inputToken: TOKENS.USDC,
    inputAmount: ONE_USDC.toString(),
    steps: [
      {
        action: "swap",
        tokenIn: TOKENS.USDC,
        tokenOut: TOKENS.cbETH,
        bps: 10000,
      },
      {
        action: "supplyCollateral",
        tokenIn: TOKENS.cbETH,
        bps: 10000,
        protocolData: { marketId: "cbETH-USDC" },
      },
      {
        action: "borrow",
        tokenIn: TOKENS.USDC,
        bps: 10000,
        protocolData: { marketId: "cbETH-USDC", targetLtv: 0.5 },
      },
    ],
    targetLtv: 0.5,
    ...o,
  };
}

export function makeRefuseIntent(reason = "unsupported request") {
  return { action: "refuse" as const, reason };
}
