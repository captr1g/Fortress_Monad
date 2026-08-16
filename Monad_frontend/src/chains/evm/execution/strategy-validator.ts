import type { MorphoMarketParams } from "@domains/yield/types/market.js";
import type { StrategyStep } from "@domains/yield/types/strategy.js";

// Thrown when a resolved strategy is not a faithful, executable representation of
// the user's prompt. The message is surfaced verbatim to the user.
export class StrategyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyValidationError";
  }
}

// Actions whose `tokenIn` is actually being received (borrowed/withdrawn),
// not spent from an existing balance — they add to what's available rather
// than requiring it.
const PRODUCES_TOKEN_IN: ReadonlySet<StrategyStep["action"]> = new Set([
  "borrow",
  "withdrawCollateral",
]);

// Validates the resolved steps against the resolved market registry. Refuses
// rather than letting the builder produce a transaction that does not match the
// prompt. All Morpho Blue markets are isolated: a borrow is only ever sized
// against collateral supplied to the SAME market earlier in the sequence.
//
// Also enforces temporal token availability: a step can't spend a token that
// no earlier step (or the strategy's own starting input) has actually
// produced yet. The LLM occasionally emits a structurally-plausible but
// impossible order — e.g. supplying cbETH as collateral in step 2 while the
// swap that would produce that cbETH doesn't happen until steps 4-5 — which
// otherwise sails through this validator (right token type, right market
// order) and only surfaces minutes later as an opaque "insufficient balance"
// revert from the simulator.
export function validateStrategy(
  steps: StrategyStep[],
  markets: Map<string, MorphoMarketParams>,
  inputToken: string,
  topLevelTargetLtv?: number,
): void {
  const collateralByMarket = new Set<string>();
  const borrowedMarkets = new Set<string>();
  const availableTokens = new Set<string>([inputToken.toLowerCase()]);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tokenIn = step.tokenIn.toLowerCase();

    if (!PRODUCES_TOKEN_IN.has(step.action) && !availableTokens.has(tokenIn)) {
      throw new StrategyValidationError(
        `Step ${i + 1} (${step.action}) spends a token no earlier step produced yet — ` +
          `reorder so whatever creates it (a swap, wrap, or borrow) comes first.`,
      );
    }

    if (step.action === "swap") {
      if (!step.tokenOut)
        throw new StrategyValidationError(
          `Swap step ${i + 1} is missing an output token.`,
        );
      availableTokens.add(step.tokenOut.toLowerCase());
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
      availableTokens.add(step.tokenOut.toLowerCase());
      continue;
    }

    if (step.action === "wrapLp") {
      if (!step.tokenOut)
        throw new StrategyValidationError(
          `wrapLp step ${i + 1} is missing the wrapped LP token address.`,
        );
      availableTokens.add(step.tokenOut.toLowerCase());
      continue;
    }

    if (PRODUCES_TOKEN_IN.has(step.action)) {
      availableTokens.add(tokenIn);
    }

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
      // A supply into a market we haven't borrowed from, occurring after some
      // borrow, means borrowed funds are being routed into a different market.
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
