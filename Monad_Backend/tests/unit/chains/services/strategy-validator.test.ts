import { describe, it, expect } from "vitest";
import {
  validateStrategy,
  StrategyValidationError,
} from "@chains/evm/execution/strategy-validator.js";
import type { StrategyStep } from "@domains/yield/types/strategy.js";
import type { MorphoMarketParams } from "@domains/yield/types/market.js";
import { TOKENS, CONTRACTS } from "../../../datasets/monad.js";

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
  ["WETH-USDC", market(TOKENS.WETH)],
  ["WMON-USDC", market(TOKENS.WMON)],
]);

const supply = (marketId = "WETH-USDC", tokenIn: `0x${string}` = TOKENS.WETH): StrategyStep => ({
  action: "supplyCollateral",
  tokenIn,
  bps: 10000,
  protocolData: { marketId },
});
const borrow = (marketId = "WETH-USDC", targetLtv?: number): StrategyStep => ({
  action: "borrow",
  tokenIn: TOKENS.USDC,
  bps: 10000,
  protocolData: { marketId, targetLtv },
});

describe("validateStrategy — accepts faithful sequences", () => {
  it("supply then borrow (per-step LTV)", () => {
    expect(() =>
      validateStrategy([supply(), borrow("WETH-USDC", 0.6)], markets, TOKENS.WETH),
    ).not.toThrow();
  });

  it("supply then borrow (top-level LTV)", () => {
    expect(() =>
      validateStrategy([supply(), borrow()], markets, TOKENS.WETH, 0.6),
    ).not.toThrow();
  });

  it("looped supply/borrow in one market", () => {
    const steps = [supply(), borrow("WETH-USDC", 0.5), supply(), borrow("WETH-USDC", 0.5)];
    expect(() => validateStrategy(steps, markets, TOKENS.WETH)).not.toThrow();
  });
});

describe("validateStrategy — refuses unsafe/unfaithful sequences", () => {
  it("borrow before collateral", () => {
    expect(() =>
      validateStrategy([borrow("WETH-USDC", 0.5)], markets, TOKENS.WETH),
    ).toThrow(StrategyValidationError);
  });

  it("borrow without an LTV", () => {
    expect(() => validateStrategy([supply(), borrow()], markets, TOKENS.WETH)).toThrow(
      /target LTV/i,
    );
  });

  it("missing market on a Morpho step", () => {
    expect(() =>
      validateStrategy(
        [{ action: "supplyCollateral", tokenIn: TOKENS.WETH, bps: 10000 }],
        markets,
        TOKENS.WETH,
      ),
    ).toThrow(/missing a market/i);
  });

  it("unknown market", () => {
    expect(() => validateStrategy([supply("ghost-USDC")], markets, TOKENS.WETH)).toThrow(
      /was not found/i,
    );
  });

  it("wrong collateral token for the market", () => {
    expect(() =>
      validateStrategy([supply("WETH-USDC", TOKENS.WMON)], markets, TOKENS.WMON),
    ).toThrow(/wrong token/i);
  });

  it("cross-market fund routing", () => {
    // Realistic shape: borrowed USDC has to be swapped into wstETH before it
    // can fund the WMON-USDC market — matches the token-ordering
    // invariant validateStrategy now also enforces, while still exercising
    // the cross-market-routing rule this test is actually about.
    const steps: StrategyStep[] = [
      supply("WETH-USDC"),
      borrow("WETH-USDC", 0.5),
      { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.WMON, bps: 10000 },
      supply("WMON-USDC", TOKENS.WMON),
    ];
    expect(() => validateStrategy(steps, markets, TOKENS.WETH)).toThrow(
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
    // The exact shape reported live: supplying WETH as collateral before
    // the swap that would produce it ever runs.
    const steps: StrategyStep[] = [
      supply("WETH-USDC"),
      borrow("WETH-USDC", 0.25),
      { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.WMON, bps: 10000 },
    ];
    expect(() => validateStrategy(steps, markets, TOKENS.USDC)).toThrow(
      /no earlier step produced/i,
    );
  });
});
