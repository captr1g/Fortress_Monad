import { describe, it, expect } from "vitest";
import {
  IntentEnvelopeSchema,
  createEnvelope,
  isRefusal,
} from "@core/planner/intent-envelope.js";

describe("IntentEnvelopeSchema", () => {
  it("accepts a well-formed envelope with an arbitrary payload", () => {
    const parsed = IntentEnvelopeSchema.parse({
      domain: "yield",
      chainKey: "monad",
      action: "deposit",
      payload: { amount: "1000000" },
    });
    expect(parsed.domain).toBe("yield");
  });

  it("rejects empty required string fields", () => {
    expect(() =>
      IntentEnvelopeSchema.parse({ domain: "", chainKey: "monad", action: "deposit", payload: {} }),
    ).toThrow();
    expect(() =>
      IntentEnvelopeSchema.parse({ domain: "yield", chainKey: "", action: "deposit", payload: {} }),
    ).toThrow();
    expect(() =>
      IntentEnvelopeSchema.parse({ domain: "yield", chainKey: "monad", action: "", payload: {} }),
    ).toThrow();
  });

  it("allows an undefined payload (payload is z.unknown)", () => {
    const parsed = IntentEnvelopeSchema.parse({
      domain: "yield",
      chainKey: "monad",
      action: "refuse",
    });
    expect(parsed.action).toBe("refuse");
  });
});

describe("createEnvelope / isRefusal", () => {
  it("builds an envelope with the given fields", () => {
    const env = createEnvelope("yield", "monad", "leverage", { multiplier: 2 });
    expect(env).toEqual({ domain: "yield", chainKey: "monad", action: "leverage", payload: { multiplier: 2 } });
  });

  it("detects refusal envelopes", () => {
    expect(isRefusal(createEnvelope("yield", "monad", "refuse", { reason: "no" }))).toBe(true);
    expect(isRefusal(createEnvelope("yield", "monad", "deposit", {}))).toBe(false);
  });
});
