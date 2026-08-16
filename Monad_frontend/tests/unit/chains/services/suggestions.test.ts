import { describe, it, expect, beforeAll } from "vitest";
import { suggestionsForError } from "@chains/evm/execution/suggestions.js";
import {
  InputTokenMismatch,
  UnsupportedAmountOverride,
  PlannerRefusal,
} from "@shared/errors.js";
import { seedRegistry } from "../../../helpers/registry.js";
import { BASE_CHAIN_ID } from "../../../datasets/base.js";

beforeAll(() => seedRegistry());

describe("suggestionsForError — typed errors", () => {
  it("suggests starting from the mismatched input token", () => {
    const out = suggestionsForError(new InputTokenMismatch("WETH", "0x42"), BASE_CHAIN_ID);
    expect(out).toHaveLength(1);
    expect(out[0].label).toContain("WETH");
    expect(out[0].insertText).toContain("WETH");
  });

  it("returns no suggestions for an unsupported amount override", () => {
    expect(suggestionsForError(new UnsupportedAmountOverride("leverage"), BASE_CHAIN_ID)).toEqual([]);
  });
});

describe("suggestionsForError — planner refusals", () => {
  it("points at the supported token list on an unknown-token refusal", () => {
    const out = suggestionsForError(new PlannerRefusal("Unknown token FOO not in the list"), BASE_CHAIN_ID);
    expect(out[0].label).toMatch(/Supported tokens:/);
    // Followed by per-token input chips (only inputEnabled tokens).
    expect(out.some((s) => s.insertText?.includes("as the input token"))).toBe(true);
  });

  it("gives a concrete starting line on a missing-amount refusal", () => {
    const out = suggestionsForError(new PlannerRefusal("Could not parse an amount"), BASE_CHAIN_ID);
    expect(out).toHaveLength(1);
    expect(out[0].insertText).toMatch(/I have 1 USDC on Base\./);
  });

  it("returns [] for a generic refusal with no actionable hint", () => {
    expect(suggestionsForError(new PlannerRefusal("request is out of scope"), BASE_CHAIN_ID)).toEqual([]);
  });
});

describe("suggestionsForError — builder/resolver failures", () => {
  it("lists supported markets when a market is not found", () => {
    const out = suggestionsForError(new Error("Morpho market xyz was not found"), BASE_CHAIN_ID);
    expect(out[0].label).toMatch(/Supported markets:/);
    // Market chips capped at 3.
    const chips = out.filter((s) => s.insertText?.includes("as collateral to Morpho market"));
    expect(chips.length).toBeLessThanOrEqual(3);
    expect(chips.length).toBeGreaterThan(0);
  });

  it("returns [] for an unrelated error", () => {
    expect(suggestionsForError(new Error("network timeout"), BASE_CHAIN_ID)).toEqual([]);
  });

  it("returns [] for an unknown chain id", () => {
    expect(suggestionsForError(new InputTokenMismatch("WETH", "0x42"), 999999)).toEqual([]);
  });

  it("handles non-Error thrown values without crashing", () => {
    expect(suggestionsForError("a plain string", BASE_CHAIN_ID)).toEqual([]);
  });
});
