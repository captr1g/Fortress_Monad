import { describe, it, expect, beforeAll } from "vitest";
import { ltvToWad } from "@chains/evm/helper/utils.js";
import { suggestionsForError } from "@chains/evm/execution/suggestions.js";
import { InputTokenMismatch } from "@shared/errors.js";
import { normalizeIntentAmount } from "@chains/evm/execution/intent-utils.js";
import type { Intent } from "@domains/yield/types/intent.js";
import { makeStrategyIntent } from "../factories/intent.js";
import { seedRegistry } from "../helpers/registry.js";
import { BASE_CHAIN_ID, TOKENS } from "../datasets/base.js";

beforeAll(() => seedRegistry());

describe("REGRESSION: ltvToWad float drift is bounded, not exact", () => {
  it("0.55 drifts by 64 wei and drift stays under 1000 wei for tested fractions", () => {
    expect(ltvToWad(0.55)).toBe(550_000_000_000_000_064n);
    for (const v of [0.01, 0.1, 0.33, 0.55, 0.66, 0.8, 0.99]) {
      const drift = ltvToWad(v) - BigInt(Math.trunc(v * 1e18));
      expect(drift < 0n ? -drift : drift).toBeLessThan(1000n);
    }
  });
});

describe("REGRESSION: InputTokenMismatch from @shared/errors is recognized by suggestionsForError", () => {
  it("recognizes InputTokenMismatch and suggests starting from the mismatched token", () => {
    const out = suggestionsForError(new InputTokenMismatch("WETH", "0x42"), BASE_CHAIN_ID);
    expect(out.length).toBe(1);
    expect(out[0].label).toContain("WETH");
  });
});

describe("REGRESSION: re-simulation clears pinned step.amountFixed for strategy intents", () => {
  it("strips amountFixed from every step on override", () => {
    const strategy = makeStrategyIntent({
      steps: [
        { action: "swap", tokenIn: TOKENS.USDC, tokenOut: TOKENS.cbETH, bps: 10000, amountFixed: "1000000" },
        { action: "supplyCollateral", tokenIn: TOKENS.cbETH, bps: 10000, protocolData: { marketId: "cbETH-USDC" } },
      ],
    });
    const out = normalizeIntentAmount(strategy as Intent, "9999999");
    if (out.action !== "strategy") throw new Error("expected strategy");
    expect(out.inputAmount).toBe("9999999");
    expect(out.steps.every((s) => s.amountFixed === undefined)).toBe(true);
  });
});
