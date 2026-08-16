import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeBorrowCeiling } from "@chains/evm/execution/pricing.js";
import { ltvToWad } from "@chains/evm/helper/utils.js";

describe("property: computeBorrowCeiling never dips below target debt", () => {
  it("ceiling >= targetDebt for any non-negative padding", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 30n }),
        fc.bigInt({ min: 1n, max: 10n ** 40n }),
        fc.integer({ min: 0, max: 100 }).map((x) => x / 100),
        fc.integer({ min: 0, max: 5000 }),
        (collateral, price, ltv, paddingBps) => {
          const targetLtvWad = ltvToWad(ltv);
          const noPad = computeBorrowCeiling({
            expectedCollateral: collateral,
            oraclePrice: price,
            targetLtvWad,
            paddingBps: 0,
          });
          const padded = computeBorrowCeiling({
            expectedCollateral: collateral,
            oraclePrice: price,
            targetLtvWad,
            paddingBps,
          });
          expect(padded).toBeGreaterThanOrEqual(noPad);
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("scales monotonically with collateral", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.bigInt({ min: 1n, max: 10n ** 24n }),
        (a, extra) => {
          const price = 10n ** 36n;
          const base = computeBorrowCeiling({ expectedCollateral: a, oraclePrice: price, targetLtvWad: ltvToWad(0.5), paddingBps: 0 });
          const more = computeBorrowCeiling({ expectedCollateral: a + extra, oraclePrice: price, targetLtvWad: ltvToWad(0.5), paddingBps: 0 });
          expect(more).toBeGreaterThanOrEqual(base);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("property: ltvToWad is monotonic and bounded on [0,1]", () => {
  it("non-decreasing and within [0, WAD]", () => {
    const WAD = 10n ** 18n;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: 0, max: 1000 }),
        (x, y) => {
          const a = Math.min(x, y) / 1000;
          const b = Math.max(x, y) / 1000;
          const wa = ltvToWad(a);
          const wb = ltvToWad(b);
          expect(wa).toBeLessThanOrEqual(wb);
          expect(wa).toBeGreaterThanOrEqual(0n);
          expect(wb).toBeLessThanOrEqual(WAD + 1000n);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
