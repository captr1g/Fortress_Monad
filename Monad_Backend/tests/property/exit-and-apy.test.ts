import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeExitAmounts } from "@chains/evm/protocols/morpho/exit-math.js";
import { aggregateStrategyApy } from "@chains/evm/execution/apy.js";
import type { StrategyLeg, StrategyLegRates } from "@core/services/apy/types.js";
import { makePositionView } from "../factories/position.js";

type Leg = StrategyLeg & StrategyLegRates;

describe("property: full_to_collateral never sells more than held (when solvent)", () => {
  it("collateralToSell <= collateral and returned = collateral - sold", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 24n }), // collateral units
        fc.bigInt({ min: 1n, max: 10n ** 15n }), // collateral value (loan units)
        fc.bigInt({ min: 1n, max: 10n ** 15n }), // debt (loan units)
        (collateral, collateralValue, debt) => {
          // Only assert on solvent positions: debt + 1% buffer covered by value.
          const debtWithBuffer = (debt * 10100n) / 10000n;
          fc.pre(debtWithBuffer <= collateralValue);

          const pos = makePositionView({ collateral, collateralValue, debt });
          const a = computeExitAmounts("full_to_collateral", pos);

          expect(a.collateralToSell).toBeLessThanOrEqual(collateral);
          expect(a.collateralReturned).toBe(collateral - a.collateralToSell);
          expect(a.collateralReturned).toBeGreaterThanOrEqual(0n);
          expect(a.repayAssets).toBe(0n);
        },
      ),
      { numRuns: 1500 },
    );
  });
});

describe("property: full_to_loan always liquidates the entire collateral", () => {
  it("collateralToSell == collateral for any position", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 30n }), (collateral) => {
        const pos = makePositionView({ collateral });
        expect(computeExitAmounts("full_to_loan", pos).collateralToSell).toBe(collateral);
      }),
      { numRuns: 500 },
    );
  });
});

describe("property: aggregateStrategyApy equity identity + availability", () => {
  const legArb = fc.record({
    collateralValue: fc.integer({ min: 0, max: 1_000_000 }),
    debtValue: fc.integer({ min: 0, max: 1_000_000 }),
    collateralApy: fc.integer({ min: 0, max: 2000 }).map((x) => x / 10000),
    borrowApy: fc.integer({ min: 0, max: 2000 }).map((x) => x / 10000),
    rewardsApy: fc.integer({ min: 0, max: 500 }).map((x) => x / 10000),
  });

  it("equity equals sumCollateral + idle - sumDebt; leverage >= 0", () => {
    fc.assert(
      fc.property(
        fc.array(legArb, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (rawLegs, idle) => {
          const legs: Leg[] = rawLegs.map((l, i) => ({
            marketKey: `m${i}`,
            marketKeyHash: `0x${i}`,
            collateralToken: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
            collateralValue: l.collateralValue,
            debtValue: l.debtValue,
            collateralApy: l.collateralApy,
            collateralStatus: "ok",
            borrowApy: l.borrowApy,
            borrowStatus: "ok",
            rewardsApy: l.rewardsApy,
          }));
          const sumC = legs.reduce((s, l) => s + l.collateralValue, 0);
          const sumD = legs.reduce((s, l) => s + l.debtValue, 0);
          const out = aggregateStrategyApy(legs, idle);
          expect(out.equity).toBeCloseTo(sumC + idle - sumD, 6);
          expect(out.leverage).toBeGreaterThanOrEqual(0);
          if (out.status === "ok") {
            expect(out.equity).toBeGreaterThan(0);
            expect(out.netApy).not.toBeNull();
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("a positive-debt leg with a missing borrow rate forces status=unavailable", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), fc.integer({ min: 1, max: 1_000_000 }), (coll, debt) => {
        const legs: Leg[] = [
          {
            marketKey: "m",
            marketKeyHash: "0x0",
            collateralToken: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
            collateralValue: coll + debt, // keep equity positive so only the missing rate can flip status
            debtValue: debt,
            collateralApy: 0.05,
            collateralStatus: "ok",
            borrowApy: null,
            borrowStatus: "unavailable",
            rewardsApy: 0,
          },
        ];
        const out = aggregateStrategyApy(legs, 0);
        expect(out.status).toBe("unavailable");
        expect(out.netApy).toBeNull();
      }),
      { numRuns: 500 },
    );
  });
});
