import { describe, it, expect } from "vitest";
import { IntentSchema, validateBpsSum } from "@domains/yield/types/intent.js";
import {
  makeDepositIntent,
  makeSplitDepositIntent,
  makeLeverageIntent,
  makeStrategyIntent,
  makeWithdrawIntent,
  makeRefuseIntent,
} from "../../../factories/intent.js";
import { TOKENS } from "../../../datasets/monad.js";

// The Intent schema is the trust boundary between the LLM and the executor.
// Anything malformed must be rejected here, before it can build calldata.

describe("IntentSchema — deposit", () => {
  it("accepts a valid single-protocol deposit", () => {
    expect(IntentSchema.parse(makeDepositIntent())).toMatchObject({ action: "deposit" });
  });

  it("accepts a multi-protocol split", () => {
    const parsed = IntentSchema.parse(makeSplitDepositIntent());
    expect(parsed.action === "deposit" && parsed.allocations).toHaveLength(2);
  });

  it("rejects a non-numeric amount (uint256 string regex)", () => {
    expect(() => IntentSchema.parse(makeDepositIntent({ amount: "1.5" }))).toThrow();
    expect(() => IntentSchema.parse(makeDepositIntent({ amount: "-1" }))).toThrow();
    expect(() => IntentSchema.parse(makeDepositIntent({ amount: "abc" }))).toThrow();
  });

  it("accepts very large integer amounts as strings (bigint-safe)", () => {
    const huge = (2n ** 256n - 1n).toString();
    expect(IntentSchema.parse(makeDepositIntent({ amount: huge }))).toMatchObject({ amount: huge });
  });

  it("rejects empty allocations and out-of-range bps", () => {
    expect(() => IntentSchema.parse(makeDepositIntent({ allocations: [] }))).toThrow();
    expect(() =>
      IntentSchema.parse(makeDepositIntent({ allocations: [{ protocol: "Morpho", bps: 0 }] })),
    ).toThrow();
    expect(() =>
      IntentSchema.parse(makeDepositIntent({ allocations: [{ protocol: "Morpho", bps: 10001 }] })),
    ).toThrow();
  });
});

describe("IntentSchema — leverage", () => {
  it("accepts a valid leverage intent", () => {
    expect(IntentSchema.parse(makeLeverageIntent())).toMatchObject({ action: "leverage", multiplier: 2 });
  });

  it("rejects a non-hex input token", () => {
    expect(() => IntentSchema.parse(makeLeverageIntent({ inputToken: "USDC" as `0x${string}` }))).toThrow();
  });

  it("rejects multiplier outside [1, 10]", () => {
    expect(() => IntentSchema.parse(makeLeverageIntent({ multiplier: 0.5 }))).toThrow();
    expect(() => IntentSchema.parse(makeLeverageIntent({ multiplier: 11 }))).toThrow();
  });

  it("accepts boundary multipliers 1 and 10", () => {
    expect(IntentSchema.parse(makeLeverageIntent({ multiplier: 1 }))).toBeTruthy();
    expect(IntentSchema.parse(makeLeverageIntent({ multiplier: 10 }))).toBeTruthy();
  });
});

describe("IntentSchema — strategy", () => {
  it("accepts a supply+borrow strategy", () => {
    expect(IntentSchema.parse(makeStrategyIntent())).toMatchObject({ action: "strategy" });
  });

  it("rejects targetLtv outside [0, 1]", () => {
    expect(() => IntentSchema.parse(makeStrategyIntent({ targetLtv: 1.5 }))).toThrow();
  });

  it("rejects more than 30 steps", () => {
    const oneStep = makeStrategyIntent().steps[0];
    expect(() =>
      IntentSchema.parse(makeStrategyIntent({ steps: Array(31).fill(oneStep) })),
    ).toThrow();
  });

  it("coerces empty-string optional uint256 fields to undefined", () => {
    const parsed = IntentSchema.parse(
      makeStrategyIntent({
        steps: [
          {
            action: "borrow",
            tokenIn: TOKENS.USDC,
            bps: 10000,
            amountFixed: "",
            protocolData: { marketId: "WETH-USDC", targetLtv: 0.5, borrowAmount: "" },
          },
        ],
      }),
    );
    if (parsed.action === "strategy") {
      expect(parsed.steps[0].amountFixed).toBeUndefined();
      expect(parsed.steps[0].protocolData?.borrowAmount).toBeUndefined();
    }
  });
});

describe("IntentSchema — discriminated union & refuse", () => {
  it("accepts a refuse intent with a reason", () => {
    expect(IntentSchema.parse(makeRefuseIntent("out of scope"))).toMatchObject({ action: "refuse" });
  });

  it("rejects refuse without a reason", () => {
    expect(() => IntentSchema.parse({ action: "refuse" })).toThrow();
  });

  it("rejects an unknown action", () => {
    expect(() => IntentSchema.parse({ action: "teleport" })).toThrow();
  });

});

describe("validateBpsSum", () => {
  it("is true only when allocations sum to exactly 10000", () => {
    expect(validateBpsSum([{ bps: 10000 }])).toBe(true);
    expect(validateBpsSum([{ bps: 5000 }, { bps: 5000 }])).toBe(true);
    expect(validateBpsSum([{ bps: 4000 }, { bps: 3000 }, { bps: 3000 }])).toBe(true);
  });

  it("is false when the sum drifts from 10000", () => {
    expect(validateBpsSum([{ bps: 5000 }, { bps: 4999 }])).toBe(false);
    expect(validateBpsSum([{ bps: 6000 }, { bps: 5000 }])).toBe(false);
    expect(validateBpsSum([])).toBe(false);
  });
});
