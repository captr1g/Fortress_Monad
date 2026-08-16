import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { IntentSchema } from "@domains/yield/types/intent.js";
import { ExitRequestSchema } from "@domains/yield/types/exit.js";
import { IntentEnvelopeSchema } from "@core/planner/intent-envelope.js";
import { expandAdversarialPrompts } from "../datasets/adversarial.js";

// The Zod schemas are the last line of defense against malformed LLM output.
// They must NEVER throw on parse — safeParse must always resolve to a discriminated
// {success} result, no matter how hostile the input.

describe("fuzz: IntentSchema.safeParse never throws", () => {
  it("survives arbitrary JSON-like values", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        const r = IntentSchema.safeParse(value);
        expect(typeof r.success).toBe("boolean");
      }),
      { numRuns: 5000 },
    );
  });

  it("rejects (but never throws on) corrupted deposit intents", () => {
    fc.assert(
      fc.property(
        fc.record({
          action: fc.constant("deposit"),
          amount: fc.anything(),
          allocations: fc.anything(),
        }),
        (obj) => {
          const r = IntentSchema.safeParse(obj);
          expect(typeof r.success).toBe("boolean");
        },
      ),
      { numRuns: 3000 },
    );
  });

  it("treats every adversarial prompt string as an invalid intent object (not a crash)", () => {
    // A raw prompt string is never a valid intent; safeParse must reject cleanly.
    for (const prompt of expandAdversarialPrompts()) {
      const r = IntentSchema.safeParse(prompt);
      expect(r.success).toBe(false);
    }
  });
});

describe("fuzz: ExitRequestSchema + IntentEnvelopeSchema never throw", () => {
  it("ExitRequestSchema.safeParse resolves for arbitrary input", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof ExitRequestSchema.safeParse(value).success).toBe("boolean");
      }),
      { numRuns: 3000 },
    );
  });

  it("IntentEnvelopeSchema.safeParse resolves for arbitrary input", () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(typeof IntentEnvelopeSchema.safeParse(value).success).toBe("boolean");
      }),
      { numRuns: 3000 },
    );
  });
});
