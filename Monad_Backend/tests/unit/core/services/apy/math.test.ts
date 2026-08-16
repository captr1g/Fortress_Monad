import { describe, it, expect } from "vitest";
import { rayToApy } from "@core/services/apy/math.js";

const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;

// Reference implementation for cross-checking
function expectedApy(ray: bigint): number {
  const apr = Number(ray) / Number(RAY);
  return Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
}

describe("rayToApy", () => {
  it("returns 0 for a zero ray rate", () => {
    expect(rayToApy(0n)).toBe(0);
  });

  it("compounds a per-second ray APR into an APY", () => {
    // 5% APR in ray
    const ray = (5n * RAY) / 100n;
    const apy = rayToApy(ray);
    expect(apy).toBeCloseTo(expectedApy(ray), 12);
    // Continuous-ish compounding pushes 5% APR slightly above 5% APY.
    expect(apy).toBeGreaterThan(0.05);
    expect(apy).toBeLessThan(0.0514);
  });

  it("stays within the sane [0, 2.0] band for a high-but-valid rate", () => {
    // 100% APR compounds to ~171.8% APY, still under the 2.0 guard.
    const ray = (100n * RAY) / 100n;
    const apy = rayToApy(ray);
    expect(apy).toBeGreaterThan(1.7);
    expect(apy).toBeLessThanOrEqual(2.0);
  });

  it("throws when the computed APY exceeds the 2.0 guard", () => {
    // ~110% APR compounds to >200% APY (e^1.1 - 1 ≈ 2.004), tripping the bound.
    const ray = (110n * RAY) / 100n;
    expect(() => rayToApy(ray)).toThrow(/out of bounds/i);
  });

  it("throws for a negative ray (APY below 0)", () => {
    expect(() => rayToApy(-RAY / 100n)).toThrow(/out of bounds/i);
  });
});
