import { describe, it, expect } from "vitest";
import {
  validateStrategy,
  StrategyValidationError,
} from "@chains/evm/execution/strategy-validator.js";
import type { StrategyStep } from "@domains/yield/types/strategy.js";
import type { MorphoMarketParams } from "@domains/yield/types/market.js";
import { TOKENS, CONTRACTS } from "../../../datasets/base.js";

// The EVM-side faithfulness gate: the resolved steps must be a safe, on-market
// representation of the prompt before the builder ever encodes calldata.

const market = (collateral: `0x${string}`): MorphoMarketParams => ({
  loanToken: TOKENS.USDC,
  collateralToken: collateral,
  oracle: CONTRACTS.MORPHO_BLUE, // any valid address; unused by the validator
  irm: CONTRACTS.MORPHO_BLUE,
  lltv: 860_000_000_000_000_000n,
});

const markets = new Map<string, MorphoMarketParams>([
  ["cbETH-USDC", market(TOKENS.cbETH)],
  ["wstETH-USDC", market(TOKENS.wstETH)],
]);

const supply = (marketId = "cbETH-USDC", tokenIn: `0x${string}` = TOKENS.cbETH): StrategyStep => ({
  action: "supplyCollateral",
  tokenIn,
  bps: 10000,
  protocolData: { marketId },
});
const borrow = (marketId = "cbETH-USDC", targetLtv?: number): StrategyStep => ({
  action: "borrow",
  tokenIn: TOKENS.USDC,
  bps: 10000,
  protocolData: { marketId, targetLtv },
});

describe("validateStrategy — accepts faithful sequences", () => {
  it("supply then borrow (per-step LTV)", () => {
    expect(() =>
      validateStrategy([supply(), borrow("cbETH-USDC", 0.6)], markets, TOKENS.cbETH),
    ).not.toThrow();
  });

  it("supply then borrow (top-level LTV)", () => {
    expect(() =>
      validateStrategy([supply(), borrow()], markets, TOKENS.cbETH, 0.6),
    ).not.toThrow();
  });

  it("looped supply/borrow in one market", () => {
    const steps = [supply(), borrow("cbETH-USDC", 0.5), supply(), borrow("cbETH-USDC", 0.5)];
    expect(() => validateStrategy(steps, markets, TOKENS.cbETH)).not.toThrow();
  });
});

describe("validateStrategy — refuses unsafe/unfaithful sequences", () => {
  it("borrow before collateral", () => {
    expect(() =>
      validateStrategy([borrow("cbETH-USDC", 0.5)], markets, TOKENS.cbETH),
    ).toThrow(StrategyValidationError);
  });

  it("borrow without an LTV", () => {
    expect(() => validateStrategy([supply(), borrow()], markets, TOKENS.cbETH)).toThrow(
      /target LTV/i,
    );
  });

  it("missing market on a Morpho step", () => {
    expect(() =>
      validateStrategy(
        [{ action: "supplyCollateral", tokenIn: TOKENS.cbETH, bps: 10000 }],
        markets,
        TOKENS.cbETH,
      ),
    ).toThrow(/missing a market/i);
  });

  it("unknown market", () => {
    expect(() => validateStrategy([supply("ghost-USDC")], markets, TOKENS.cbETH)).toThrow(
      /was not found/i,
    );
  });

  it("wrong collateral token for the market", () => {
    expect(() =>
      validateStrategy([supply("cbETH-USDC", TOKENS.wstETH)], markets, TOKENS.wstETH),
    ).toThrow(/wrong token/i);
  });

  it("cross-market fund routing", () => {
    // Realistic shape: borrowed USDC has to be swapped into wstETH before it
    // can fund the wstETH-USDC market — matches the token-ordering
    // invariant validateStrategy now also enforces, while still exercising
    // the cross-market-routing rule this test is actually about.
    const steps: StrategyStep[] = [
      supply("cbETH-USDC"),
      borrow("cbETH-USDC", 0.5),
      { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.wstETH, bps: 10000 },
      supply("wstETH-USDC", TOKENS.wstETH),
    ];
    expect(() => validateStrategy(steps, markets, TOKENS.cbETH)).toThrow(
      /different collateral market/i,
    );
  });

  it("swap without an output token", () => {
    expect(() =>
      validateStrategy(
        [{ action: "swap", tokenIn: TOKENS.USDC, bps: 10000 }],
        markets,
        TOKENS.USDC,
      ),
    ).toThrow(/output token/i);
  });

  it("step spends a token no earlier step produced", () => {
    // The exact shape reported live: supplying cbETH as collateral before
    // the swap that would produce it ever runs.
    const steps: StrategyStep[] = [
      supply("cbETH-USDC"),
      borrow("cbETH-USDC", 0.25),
      { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.wstETH, bps: 10000 },
    ];
    expect(() => validateStrategy(steps, markets, TOKENS.USDC)).toThrow(
      /no earlier step produced/i,
    );
  });
});
