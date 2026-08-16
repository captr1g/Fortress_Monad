import { describe, it, expect } from "vitest";
import { ltvToWad, norm } from "@chains/evm/helper/utils.js";

describe("ltvToWad", () => {
  it("scales a fractional LTV to 1e18 WAD", () => {
    expect(ltvToWad(0.5)).toBe(500_000_000_000_000_000n);
    expect(ltvToWad(0.8)).toBe(800_000_000_000_000_000n);
  });

  it("maps 0 and 1 to their WAD bounds", () => {
    expect(ltvToWad(0)).toBe(0n);
    expect(ltvToWad(1)).toBe(1_000_000_000_000_000_000n);
  });

  it("rounds to the nearest integer wad (no floating dust)", () => {
    // 0.333 * 1e18 = 3.33e17; Math.round keeps it exact to the wad
    expect(ltvToWad(0.333)).toBe(333_000_000_000_000_000n);
    // A value that would otherwise carry float error
    expect(ltvToWad(0.1)).toBe(100_000_000_000_000_000n);
  });

  it("handles values above 1 (defense-in-depth, not clamped here)", () => {
    expect(ltvToWad(1.5)).toBe(1_500_000_000_000_000_000n);
  });

  it("carries IEEE-754 rounding drift for some fractions (documented, sub-wei)", () => {
    // 0.55 is not exactly representable in float64; Math.round(0.55 * 1e18)
    // lands 64 wei above the mathematical value, pinned here so a
    // future change to the conversion (e.g. string/bigint based) is a conscious one.
    expect(ltvToWad(0.55)).toBe(550_000_000_000_000_064n);
    const drift = ltvToWad(0.55) - 550_000_000_000_000_000n;
    expect(drift).toBeLessThanOrEqual(1000n);
  });
});

describe("norm", () => {
  it("strips non-alphanumerics and lowercases", () => {
    expect(norm("WETH-USDC")).toBe("wethusdc");
    expect(norm("Morpho Blue!")).toBe("morphoblue");
  });

  it("returns empty string for punctuation-only input", () => {
    expect(norm("---")).toBe("");
    expect(norm("")).toBe("");
  });

  it("keeps digits and drops unicode/emoji", () => {
    expect(norm("USD₮ 100")).toBe("usd100");
    expect(norm("cb\u{1F600}ETH")).toBe("cbeth");
  });

  it("is idempotent", () => {
    const once = norm("WETH/USDC");
    expect(norm(once)).toBe(once);
  });
});
