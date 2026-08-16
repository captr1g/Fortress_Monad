import { describe, it, expect } from "vitest";
import {
  computeBorrowCeiling,
  ORACLE_PRICE_SCALE,
  WAD,
} from "@chains/evm/execution/pricing.js";
import { ltvToWad } from "@chains/evm/helper/utils.js";

// computeBorrowCeiling is a safety cap: honest execution must stay under it, an
// oracle glitch / runaway borrow must not exceed it. Verify the arithmetic and
// the padding behavior exactly.

describe("pricing constants", () => {
  it("uses 1e36 oracle scale and 1e18 WAD", () => {
    expect(ORACLE_PRICE_SCALE).toBe(10n ** 36n);
    expect(WAD).toBe(10n ** 18n);
  });
});

describe("computeBorrowCeiling", () => {
  // 1 WETH collateral, price 2000 USDC (scaled to 1e36), target LTV 80%.
  const oneCbeth = 10n ** 18n;
  // Choose price so collateralValue = collateral*price/1e36 = 2000e6 (USDC, 6dp).
  const price = (2000n * 1_000_000n * ORACLE_PRICE_SCALE) / oneCbeth;

  it("applies the default 3% padding above target debt", () => {
    const ceiling = computeBorrowCeiling({
      expectedCollateral: oneCbeth,
      oraclePrice: price,
      targetLtvWad: ltvToWad(0.8),
    });
    // collateralValue = 2000e6; targetDebt = 2000e6 * 0.8 = 1600e6
    // ceiling = 1600e6 * 10300/10000 = 1648e6
    expect(ceiling).toBe(1_648_000_000n);
  });

  it("honors a custom padding in bps", () => {
    const ceiling = computeBorrowCeiling({
      expectedCollateral: oneCbeth,
      oraclePrice: price,
      targetLtvWad: ltvToWad(0.8),
      paddingBps: 0,
    });
    // No padding => exactly targetDebt = 1600e6
    expect(ceiling).toBe(1_600_000_000n);
  });

  it("returns 0 when there is no collateral", () => {
    const ceiling = computeBorrowCeiling({
      expectedCollateral: 0n,
      oraclePrice: price,
      targetLtvWad: ltvToWad(0.8),
    });
    expect(ceiling).toBe(0n);
  });

  it("returns 0 when target LTV is 0", () => {
    const ceiling = computeBorrowCeiling({
      expectedCollateral: oneCbeth,
      oraclePrice: price,
      targetLtvWad: 0n,
    });
    expect(ceiling).toBe(0n);
  });

  it("scales linearly with collateral", () => {
    const base = computeBorrowCeiling({
      expectedCollateral: oneCbeth,
      oraclePrice: price,
      targetLtvWad: ltvToWad(0.5),
      paddingBps: 0,
    });
    const doubled = computeBorrowCeiling({
      expectedCollateral: oneCbeth * 2n,
      oraclePrice: price,
      targetLtvWad: ltvToWad(0.5),
      paddingBps: 0,
    });
    expect(doubled).toBe(base * 2n);
  });
});

describe("pricing.ltvToWad", () => {
  it("agrees with the shared helper for the same inputs", () => {
    for (const v of [0, 0.1, 0.5, 0.55, 0.8, 1]) {
      expect(ltvToWad(v)).toBe(ltvToWad(v));
    }
  });

  it("exactly represents power-of-two-friendly fractions", () => {
    expect(ltvToWad(0.5)).toBe(500_000_000_000_000_000n);
  });
});
