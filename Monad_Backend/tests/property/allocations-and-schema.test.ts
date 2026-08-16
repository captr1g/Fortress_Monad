import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { IntentSchema, validateBpsSum } from "@domains/yield/types/intent.js";

// Invariant: validateBpsSum is true IFF the bps sum is exactly 10000.
describe("property: allocation bps sum", () => {
  it("agrees with the arithmetic sum for any allocation set", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 10000 }), { minLength: 1, maxLength: 8 }),
        (bpsList) => {
          const allocations = bpsList.map((bps) => ({ bps }));
          const sum = bpsList.reduce((a, b) => a + b, 0);
          expect(validateBpsSum(allocations)).toBe(sum === 10000);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("holds for two-way splits that sum to 10000", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 9999 }), (a) => {
        expect(validateBpsSum([{ bps: a }, { bps: 10000 - a }])).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

// Invariant: any positive integer string is a valid uint256 amount; anything
// with a sign, decimal, or non-digit is rejected. The schema is the trust
// boundary, so this must never regress.
describe("property: deposit amount is a strict uint256 string", () => {
  it("accepts arbitrary big non-negative integer strings", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 2n ** 256n - 1n }), (n) => {
        const parsed = IntentSchema.safeParse({
          action: "deposit",
          amount: n.toString(),
          allocations: [{ protocol: "Morpho", bps: 10000 }],
        });
        expect(parsed.success).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });

  it("rejects decimals, signs, and non-digit noise", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.float({ noNaN: true, noDefaultInfinity: true }).map((f) => `${f}.5`),
          fc.bigInt({ min: 1n, max: 10n ** 30n }).map((n) => `-${n}`),
          fc.string().filter((s) => /[^0-9]/.test(s) && s.length > 0),
        ),
        (bad) => {
          const parsed = IntentSchema.safeParse({
            action: "deposit",
            amount: bad,
            allocations: [{ protocol: "Morpho", bps: 10000 }],
          });
          expect(parsed.success).toBe(false);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
