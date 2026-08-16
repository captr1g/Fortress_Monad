import { describe, it, expect } from "vitest";
import {
  validateStrategySteps,
  StrategyValidationError,
  type MarketParams,
} from "@domains/yield/validators.js";
import type { StrategyStep as StrategyStepType } from "@domains/yield/types/strategy.js";
import { TOKENS } from "../../../datasets/base.js";

// Isolated-market safety: collateral must precede a borrow in the SAME market,
// tokens must match the market, and a borrow needs an LTV. These rules keep the
// planner from emitting an unsafe or unfaithful executor sequence.

const markets = new Map<string, MarketParams>([
  ["cbETH-USDC", { loanToken: TOKENS.USDC, collateralToken: TOKENS.cbETH }],
  ["wstETH-USDC", { loanToken: TOKENS.USDC, collateralToken: TOKENS.wstETH }],
]);

const supply = (market = "cbETH-USDC", tokenIn = TOKENS.cbETH): StrategyStepType => ({
  action: "supplyCollateral",
  tokenIn,
  bps: 10000,
  protocolData: { marketId: market },
});
const borrow = (market = "cbETH-USDC", targetLtv?: number): StrategyStepType => ({
  action: "borrow",
  tokenIn: TOKENS.USDC,
  bps: 10000,
  protocolData: { marketId: market, targetLtv },
});

describe("validateStrategySteps — happy paths", () => {
  it("accepts supply then borrow with an LTV in the same market", () => {
    expect(() => validateStrategySteps([supply(), borrow("cbETH-USDC", 0.5)], markets)).not.toThrow();
  });

  it("accepts a borrow relying on the top-level target LTV", () => {
    expect(() => validateStrategySteps([supply(), borrow("cbETH-USDC")], markets, 0.5)).not.toThrow();
  });

  it("accepts a swap step with an output token", () => {
    const steps: StrategyStepType[] = [
      { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.cbETH, bps: 10000 },
      supply(),
      borrow("cbETH-USDC", 0.5),
    ];
    expect(() => validateStrategySteps(steps, markets)).not.toThrow();
  });
});

describe("validateStrategySteps — refusals", () => {
  it("rejects a swap without an output token", () => {
    expect(() =>
      validateStrategySteps([{ action: "swap", tokenIn: TOKENS.USDC, bps: 10000 }], markets),
    ).toThrow(StrategyValidationError);
  });

  it("rejects a borrow before any collateral is supplied", () => {
    expect(() => validateStrategySteps([borrow("cbETH-USDC", 0.5)], markets)).toThrow(
      /no collateral was supplied/i,
    );
  });

  it("rejects a borrow with no LTV anywhere", () => {
    expect(() => validateStrategySteps([supply(), borrow("cbETH-USDC")], markets)).toThrow(
      /target LTV/i,
    );
  });

  it("rejects a Morpho step missing a market", () => {
    const step: StrategyStepType = { action: "supplyCollateral", tokenIn: TOKENS.cbETH, bps: 10000 };
    expect(() => validateStrategySteps([step], markets)).toThrow(/missing a market/i);
  });

  it("rejects an unknown market", () => {
    expect(() => validateStrategySteps([supply("nope-USDC")], markets)).toThrow(/was not found/i);
  });

  it("rejects supplying the wrong collateral token for the market", () => {
    expect(() => validateStrategySteps([supply("cbETH-USDC", TOKENS.wstETH)], markets)).toThrow(
      /wrong token/i,
    );
  });

  it("rejects borrowing the wrong token for the market", () => {
    const wrongBorrow: StrategyStepType = {
      action: "borrow",
      tokenIn: TOKENS.WETH,
      bps: 10000,
      protocolData: { marketId: "cbETH-USDC", targetLtv: 0.5 },
    };
    expect(() => validateStrategySteps([supply(), wrongBorrow], markets)).toThrow(/wrong token/i);
  });

  it("rejects cross-market routing (borrow one market, supply another)", () => {
    const steps: StrategyStepType[] = [
      supply("cbETH-USDC"),
      borrow("cbETH-USDC", 0.5),
      supply("wstETH-USDC", TOKENS.wstETH),
    ];
    expect(() => validateStrategySteps(steps, markets)).toThrow(/different collateral market/i);
  });

  it("rejects a Pendle step missing its market", () => {
    const step: StrategyStepType = {
      action: "swapToPt",
      tokenIn: TOKENS.USDC,
      tokenOut: TOKENS.cbETH,
      bps: 10000,
      protocolData: {},
    };
    expect(() => validateStrategySteps([step], markets)).toThrow(/Pendle market/i);
  });

  it("rejects a wrapLp step without the wrapped token", () => {
    const step: StrategyStepType = { action: "wrapLp", tokenIn: TOKENS.USDC, bps: 10000 };
    expect(() => validateStrategySteps([step], markets)).toThrow(/wrapLp/i);
  });
});
