import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  validateStrategySteps,
  StrategyValidationError,
  type MarketParams,
} from "@domains/yield/validators.js";
import type { StrategyStep as StrategyStepType } from "@domains/yield/types/strategy.js";
import {
  normalizeIntentAmount,
} from "@chains/evm/execution/intent-utils.js";
import { UnsupportedAmountOverride } from "@shared/errors.js";
import { norm } from "@chains/evm/helper/utils.js";
import type { Intent } from "@domains/yield/types/intent.js";
import { makeWithdrawIntent, makeDepositIntent } from "../factories/intent.js";
import { TOKENS } from "../datasets/monad.js";

const markets = new Map<string, MarketParams>([
  ["WETH-USDC", { loanToken: TOKENS.USDC, collateralToken: TOKENS.WETH }],
  ["WMON-USDC", { loanToken: TOKENS.USDC, collateralToken: TOKENS.WMON }],
]);

const ACTIONS = [
  "swap",
  "swapToPt",
  "swapToYt",
  "addLiquidityPendle",
  "wrapLp",
  "supplyCollateral",
  "borrow",
  "repay",
  "withdrawCollateral",
] as const;

const tokenArb = fc.constantFrom(TOKENS.USDC, TOKENS.WETH, TOKENS.WMON, TOKENS.WETH);

// A step generator that always satisfies the post-schema contract (tokenIn is a
// real address string) but is otherwise semantically adversarial.
const stepArb: fc.Arbitrary<StrategyStepType> = fc.record({
  action: fc.constantFrom(...ACTIONS),
  tokenIn: tokenArb,
  tokenOut: fc.option(tokenArb, { nil: undefined }),
  bps: fc.integer({ min: 0, max: 10000 }),
  protocolData: fc.option(
    fc.record({
      marketId: fc.option(fc.constantFrom("WETH-USDC", "WMON-USDC", "ghost-USDC"), { nil: undefined }),
      pendleMarket: fc.option(fc.constant(TOKENS.WETH), { nil: undefined }),
      targetLtv: fc.option(fc.integer({ min: 0, max: 100 }).map((x) => x / 100), { nil: undefined }),
    }),
    { nil: undefined },
  ),
}) as fc.Arbitrary<StrategyStepType>;

describe("fuzz: validateStrategySteps only ever throws StrategyValidationError", () => {
  it("never throws an unexpected error type for random step sequences", () => {
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 0, maxLength: 12 }), (steps) => {
        try {
          validateStrategySteps(steps, markets);
        } catch (e) {
          // The ONLY acceptable failure mode is a domain validation error.
          expect(e).toBeInstanceOf(StrategyValidationError);
          expect((e as Error).message.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 5000 },
    );
  });
});

describe("fuzz: normalizeIntentAmount is total and never corrupts", () => {
  it("deposit rescale echoes any uint256 amount, never throws", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (n) => {
        const out = normalizeIntentAmount(makeDepositIntent() as Intent, n.toString());
        expect(out.action === "deposit" && out.amount).toBe(n.toString());
      }),
      { numRuns: 2000 },
    );
  });

  it("withdraw rescale always rejects with UnsupportedAmountOverride", () => {
    fc.assert(
      fc.property(fc.string(), (amt) => {
        expect(() => normalizeIntentAmount(makeWithdrawIntent() as Intent, amt)).toThrow(
          UnsupportedAmountOverride,
        );
      }),
      { numRuns: 1000 },
    );
  });
});

describe("fuzz: norm() is total and charset-bounded", () => {
  it("returns only [a-z0-9], is idempotent, and never throws on unicode/emoji/control chars", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme" }), (s) => {
        const once = norm(s);
        expect(/^[a-z0-9]*$/.test(once)).toBe(true);
        expect(norm(once)).toBe(once);
      }),
      { numRuns: 5000 },
    );
  });

  it("handles the explicit adversarial encoding corpus", () => {
    const nasty = ["\u0000\u0000", "🚀🚀", "d̸̢̛e̷p̴o̵s̶i̷t̸", "ＤＥＰＯＳＩＴ", "\t\n\r", "".padEnd(100_000, "x")];
    for (const s of nasty) {
      const once = norm(s);
      expect(/^[a-z0-9]*$/.test(once)).toBe(true);
    }
  });
});
