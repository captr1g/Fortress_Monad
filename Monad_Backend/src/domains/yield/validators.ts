// Strategy Validator to make sure that we dont borrow before any collateral supply

import type { StrategyStep as StrategyStepType } from "./types/strategy.js";

export class StrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyValidationError";
  }
}

export type MarketParams = {
  loanToken: string;
  collateralToken: string;
};

const MORPHO_ACTIONS = new Set([
  "supplyCollateral",
  "borrow",
  "repay",
  "withdrawCollateral",
]);

export function validateStrategySteps(
  steps: StrategyStepType[],
  markets: Map<string, MarketParams>,
  topLevelTargetLtv?: number,
): void {
  const collateralByMarket = new Set<string>();
  const borrowedMarkets = new Set<string>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    if (step.action === "swap") {
      if (!step.tokenOut)
        throw new StrategyValidationError(
          `Swap step ${i + 1} is missing an output token.`,
        );
      continue;
    }

    if (
      step.action === "swapToPt" ||
      step.action === "swapToYt" ||
      step.action === "addLiquidityPendle"
    ) {
      if (!step.protocolData?.pendleMarket)
        throw new StrategyValidationError(
          `${step.action} step ${i + 1} is missing a Pendle market.`,
        );
      if (!step.tokenOut)
        throw new StrategyValidationError(
          `${step.action} step ${i + 1} did not resolve an output token.`,
        );
      continue;
    }

    if (step.action === "wrapLp") {
      if (!step.tokenOut)
        throw new StrategyValidationError(
          `wrapLp step ${i + 1} is missing the wrapped LP token address.`,
        );
      continue;
    }

    if (!MORPHO_ACTIONS.has(step.action)) continue;

    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new StrategyValidationError(
        `Step ${i + 1} (${step.action}) is missing a market. Name the Morpho market, e.g. "cbETH-USDC".`,
      );

    const market = markets.get(marketId);
    if (!market)
      throw new StrategyValidationError(
        `Morpho market "${marketId}" was not found on this chain.`,
      );

    if (step.action === "supplyCollateral") {
      if (step.tokenIn.toLowerCase() !== market.collateralToken.toLowerCase())
        throw new StrategyValidationError(
          `Step ${i + 1} supplies the wrong token for market "${marketId}".`,
        );
      if (borrowedMarkets.size > 0 && !borrowedMarkets.has(marketId))
        throw new StrategyValidationError(
          "Borrowing against one market to fund a different collateral market is not supported yet.",
        );
      collateralByMarket.add(marketId);
    }

    if (step.action === "borrow") {
      if (step.tokenIn.toLowerCase() !== market.loanToken.toLowerCase())
        throw new StrategyValidationError(
          `Step ${i + 1} borrows the wrong token for market "${marketId}".`,
        );
      if (!collateralByMarket.has(marketId))
        throw new StrategyValidationError(
          `Step ${i + 1} borrows from "${marketId}" but no collateral was supplied to that market first.`,
        );
      const ltv = step.protocolData?.targetLtv ?? topLevelTargetLtv;
      if (ltv === undefined)
        throw new StrategyValidationError(
          `Step ${i + 1} (borrow) needs a target LTV (e.g. "borrow at 55% LTV").`,
        );
      borrowedMarkets.add(marketId);
    }
  }
}
