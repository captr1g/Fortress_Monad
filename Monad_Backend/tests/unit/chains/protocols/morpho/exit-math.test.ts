import { describe, it, expect } from "vitest";
import {
  computeExitAmounts,
  collateralForLoanValue,
} from "@chains/evm/protocols/morpho/exit-math.js";
import { makePositionView } from "../../../../factories/position.js";

// The exit math is the money path for closing/deleveraging positions. Every mode
// and every boundary (underwater, target >= current, exact) is pinned here.

describe("collateralForLoanValue", () => {
  it("returns the pro-rata collateral for a loan value", () => {
    const pos = makePositionView(); // 2 WETH == 4 USDC value
    // 2 USDC of loan value => half the collateral => 1 WETH
    expect(collateralForLoanValue(pos, 2_000_000n)).toBe(1_000_000_000_000_000_000n);
  });

  it("returns full collateral when loanValue equals collateralValue", () => {
    const pos = makePositionView();
    expect(collateralForLoanValue(pos, pos.collateralValue)).toBe(pos.collateral);
  });

  it("returns 0 when collateralValue is 0 (no divide-by-zero)", () => {
    const pos = makePositionView({ collateralValue: 0n, collateral: 5n });
    expect(collateralForLoanValue(pos, 1_000_000n)).toBe(0n);
  });

  it("returns 0 when loanValue is 0", () => {
    const pos = makePositionView();
    expect(collateralForLoanValue(pos, 0n)).toBe(0n);
  });

  it("floors via integer division (no rounding up)", () => {
    // collateral 3, value 3 => 1:1; loanValue 2 => floor(3*2/3)=2
    const pos = makePositionView({ collateral: 3n, collateralValue: 3n });
    expect(collateralForLoanValue(pos, 2n)).toBe(2n);
    // loanValue that doesn't divide evenly: collateral 10, value 3, loan 1 => floor(10/3)=3
    const pos2 = makePositionView({ collateral: 10n, collateralValue: 3n });
    expect(collateralForLoanValue(pos2, 1n)).toBe(3n);
  });
});

describe("computeExitAmounts — full_to_loan", () => {
  it("sells the entire collateral and repays nothing directly", () => {
    const pos = makePositionView();
    const a = computeExitAmounts("full_to_loan", pos);
    expect(a).toEqual({
      repayAssets: 0n,
      withdrawAssets: 0n,
      collateralToSell: pos.collateral,
      collateralReturned: 0n,
    });
  });
});

describe("computeExitAmounts — full_to_collateral", () => {
  it("sells only enough collateral (with 1% buffer) to cover debt and returns the rest", () => {
    const pos = makePositionView(); // debt 1 USDC, 2 WETH == 4 USDC
    const a = computeExitAmounts("full_to_collateral", pos);
    // debtWithBuffer = 1_000_000 * 10100/10000 = 1_010_000
    // collateralToSell = collateralForLoanValue(pos, 1_010_000)
    //   = 1_010_000 * 2e18 / 4_000_000 = 505_000_000_000_000_000 (0.505 WETH)
    expect(a.collateralToSell).toBe(505_000_000_000_000_000n);
    expect(a.collateralReturned).toBe(pos.collateral - a.collateralToSell);
    expect(a.repayAssets).toBe(0n);
    expect(a.withdrawAssets).toBe(0n);
  });

  it("throws when the position is underwater (collateral cannot cover debt+buffer)", () => {
    // debt so large that debtWithBuffer implies more collateral than exists.
    const pos = makePositionView({ debt: 4_000_000n }); // equals collateralValue; +1% buffer exceeds it
    expect(() => computeExitAmounts("full_to_collateral", pos)).toThrow(/underwater/i);
  });
});

describe("computeExitAmounts — deleverage", () => {
  it("throws when targetLtv is omitted", () => {
    const pos = makePositionView();
    expect(() => computeExitAmounts("deleverage", pos)).toThrow(/targetLtv/i);
  });

  it("throws when target LTV is not below the current LTV", () => {
    // current LTV = debt/collateralValue = 1/4 = 0.25. Target 0.5 => nothing to do.
    const pos = makePositionView();
    expect(() => computeExitAmounts("deleverage", pos, 0.5)).toThrow(/not below/i);
  });

  it("computes repay/withdraw to reach a lower target LTV", () => {
    // Start at LTV 0.5: debt 2 USDC against 4 USDC collateral value.
    const pos = makePositionView({ debt: 2_000_000n });
    const a = computeExitAmounts("deleverage", pos, 0.25);
    // targetDebt = collateralValue * 0.25 = 1_000_000
    // repay = (debt - targetDebt) * WAD / (WAD - 0.25*WAD)
    //       = 1_000_000 / 0.75 = 1_333_333 (floored)
    expect(a.repayAssets).toBe(1_333_333n);
    // withdraw = collateralForLoanValue(pos, repay*1.01)
    //   repayWithBuffer = 1_333_333 * 10100/10000 = 1_346_666
    //   withdraw = 1_346_666 * 2e18 / 4_000_000 = 673_333_000_000_000_000
    expect(a.withdrawAssets).toBe(673_333_000_000_000_000n);
    expect(a.collateralToSell).toBe(a.withdrawAssets);
    expect(a.collateralReturned).toBe(0n);
  });

  it("throws when reaching the target would need more collateral than held", () => {
    // Near-liquidation position: debt almost equals collateral value, so the
    // buffered repay to reach 50% LTV needs slightly more collateral than exists.
    const pos = makePositionView({
      debt: 3_990_000n, // LTV ~99.75%
      collateralValue: 4_000_000n,
      collateral: 2_000_000_000_000_000_000n, // 2 units
    });
    expect(() => computeExitAmounts("deleverage", pos, 0.5)).toThrow(/Insufficient collateral/i);
  });
});
