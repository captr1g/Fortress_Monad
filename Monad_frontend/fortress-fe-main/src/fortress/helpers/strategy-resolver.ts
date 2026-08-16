import type { StrategyStep } from "../types/strategy.js";

export type MarketInfo = {
  marketId: string;
  collateralToken: `0x${string}`;
  borrowToken: `0x${string}`;
  lltv: number;
  oraclePrice: bigint; // collateral per 1 borrow token, scaled to 1e36
};

export type ResolveContext = {
  inputAmount: bigint;
  targetLtv: number;
  market: MarketInfo;
};

/**
 * Expands a looped leverage strategy into flat steps with computed borrow amounts.
 *
 * Pattern: swap → supply → (borrow → swap → supply) × N
 * Each borrow amount = (collateral_value * targetLtv) - existing_debt
 * Since we don't have the oracle price at build time for exact math, the backend
 * computes estimated borrow amounts based on expected swap outputs.
 */
export function expandLeverageLoop(params: {
  inputToken: `0x${string}`;
  collateralToken: `0x${string}`;
  borrowToken: `0x${string}`;
  inputAmount: bigint;
  targetLtv: number;
  loops: number;
  marketId: string;
  swapSlippage?: number;
}): StrategyStep[] {
  const {
    inputToken,
    collateralToken,
    borrowToken,
    inputAmount,
    targetLtv,
    loops,
    marketId,
    swapSlippage,
  } = params;
  const steps: StrategyStep[] = [];

  // Step 1: Initial swap (inputToken → collateralToken)
  // If inputToken IS the collateralToken, skip the swap
  if (inputToken.toLowerCase() !== collateralToken.toLowerCase()) {
    steps.push({
      action: "swap",
      tokenIn: inputToken,
      tokenOut: collateralToken,
      bps: 10000,
      protocolData: { slippage: swapSlippage ?? 0.005 },
    });
  }

  // Step 2: Initial supply collateral
  steps.push({
    action: "supplyCollateral",
    tokenIn: collateralToken,
    bps: 10000,
    protocolData: { marketId },
  });

  // Estimate collateral value geometrically for borrow amount computation
  // Each loop: borrow = currentCollateralValue * targetLtv (approximate)
  // The actual amounts will be computed more precisely in the strategy-builder
  // using live swap quotes. Here we provide "estimated" fixed borrow amounts.
  let estimatedCollateral = inputAmount;

  for (let i = 0; i < loops; i++) {
    // Borrow step — amount computed as: collateral * targetLtv
    const borrowAmount =
      (estimatedCollateral * BigInt(Math.floor(targetLtv * 10000))) / 10000n;

    steps.push({
      action: "borrow",
      tokenIn: borrowToken,
      bps: 0,
      protocolData: { marketId, borrowAmount: borrowAmount.toString() },
    });

    // Swap borrowed tokens back to collateral
    steps.push({
      action: "swap",
      tokenIn: borrowToken,
      tokenOut: collateralToken,
      bps: 10000,
      protocolData: { slippage: swapSlippage ?? 0.005 },
    });

    // Supply the swapped collateral
    steps.push({
      action: "supplyCollateral",
      tokenIn: collateralToken,
      bps: 10000,
      protocolData: { marketId },
    });

    // Update estimates for next iteration (approximate 1:1 for stablecoins, adjust for volatile pairs)
    estimatedCollateral = borrowAmount; // next iteration borrows against this marginal collateral
  }

  return steps;
}
