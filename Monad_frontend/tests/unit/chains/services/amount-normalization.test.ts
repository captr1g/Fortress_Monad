import { describe, it, expect } from "vitest";
import {
  normalizeIntentAmount,
  intentInputToken,
} from "@chains/evm/execution/intent-utils.js";
import { UnsupportedAmountOverride } from "@shared/errors.js";
import type { Intent } from "@domains/yield/types/intent.js";
import {
  makeDepositIntent,
  makeStrategyIntent,
  makeLeverageIntent,
  makeBridgeIntent,
  makeWithdrawIntent,
  makeRebalanceIntent,
} from "../../../factories/intent.js";
import { TOKENS } from "../../../datasets/base.js";

// normalizeIntentAmount powers the LLM-free /simulate rescale. Getting it wrong
// means a re-simulated plan sizes off the OLD amount — a correctness/safety bug.

describe("intentInputToken", () => {
  it("returns the input token for strategy / leverage / swapAndDeposit", () => {
    expect(intentInputToken(makeStrategyIntent() as Intent)).toBe(TOKENS.USDC);
    expect(intentInputToken(makeLeverageIntent() as Intent)).toBe(TOKENS.USDC);
    expect(
      intentInputToken({
        action: "swapAndDeposit",
        inputToken: TOKENS.WETH,
        amount: "1",
        minUsdcOut: "1",
        allocations: [{ protocol: "Morpho", bps: 10000 }],
      } as Intent),
    ).toBe(TOKENS.WETH);
  });

  it("returns undefined for intents with no single starting token", () => {
    expect(intentInputToken(makeDepositIntent() as Intent)).toBeUndefined();
    expect(intentInputToken(makeWithdrawIntent() as Intent)).toBeUndefined();
    expect(intentInputToken(makeRebalanceIntent() as Intent)).toBeUndefined();
  });
});

describe("normalizeIntentAmount — rescalable intents", () => {
  it("rewrites deposit.amount", () => {
    const out = normalizeIntentAmount(makeDepositIntent() as Intent, "5000000");
    expect(out.action === "deposit" && out.amount).toBe("5000000");
  });

  it("rewrites bridge.amount", () => {
    const out = normalizeIntentAmount(makeBridgeIntent() as Intent, "7000000");
    expect(out.action === "bridge" && out.amount).toBe("7000000");
  });

  it("rewrites leverage.inputAmount", () => {
    const out = normalizeIntentAmount(makeLeverageIntent() as Intent, "9000000");
    expect(out.action === "leverage" && out.inputAmount).toBe("9000000");
  });

  it("rewrites strategy.inputAmount AND strips per-step amountFixed", () => {
    const strategy = makeStrategyIntent({
      steps: [
        {
          action: "swap",
          tokenIn: TOKENS.USDC,
          tokenOut: TOKENS.cbETH,
          bps: 10000,
          amountFixed: "1000000", // pinned to the OLD amount by a prior resolve pass
        },
        {
          action: "supplyCollateral",
          tokenIn: TOKENS.cbETH,
          bps: 10000,
          protocolData: { marketId: "cbETH-USDC" },
        },
      ],
    });
    const out = normalizeIntentAmount(strategy as Intent, "3000000");
    if (out.action !== "strategy") throw new Error("expected strategy");
    expect(out.inputAmount).toBe("3000000");
    // Every step must have amountFixed cleared so bps sizing recomputes from scratch.
    expect(out.steps.every((s) => !("amountFixed" in s) || s.amountFixed === undefined)).toBe(true);
  });

  it("does not mutate the original intent (returns a new object)", () => {
    const original = makeDepositIntent();
    const before = original.amount;
    normalizeIntentAmount(original as Intent, "999");
    expect(original.amount).toBe(before);
  });
});

describe("normalizeIntentAmount — unsupported intents", () => {
  it("throws UnsupportedAmountOverride for withdraw", () => {
    expect(() => normalizeIntentAmount(makeWithdrawIntent() as Intent, "1")).toThrow(
      UnsupportedAmountOverride,
    );
  });

  it("throws UnsupportedAmountOverride for rebalance", () => {
    expect(() => normalizeIntentAmount(makeRebalanceIntent() as Intent, "1")).toThrow(
      /don't support an amount override/,
    );
  });
});
