import { describe, it, expect, beforeAll } from "vitest";
import { suggestionsForError } from "@chains/evm/execution/suggestions.js";
import { seedRegistry } from "../../../helpers/registry.js";
import { MONAD_CHAIN_ID } from "../../../datasets/monad.js";

beforeAll(() => seedRegistry());

describe("suggestionsForError — new contract revert errors (Prep_launch)", () => {
  it("handles UnauthorizedSelector revert", () => {
    const out = suggestionsForError(new Error("UnauthorizedSelector(0x12345678)"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/unsupported DEX function/i);
  });

  it("handles UnauthorizedDex revert", () => {
    const out = suggestionsForError(new Error("UnauthorizedDex(0xabcdef)"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/not whitelisted/i);
  });

  it("handles SlippageExceeded revert", () => {
    const out = suggestionsForError(new Error("SlippageExceeded(990000, 995000)"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/slippage/i);
    expect(out.some((s) => s.insertText)).toBe(true);
  });

  it("handles InsufficientOutput revert", () => {
    const out = suggestionsForError(new Error("InsufficientOutput(1000, 500)"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/less output than expected/i);
  });

  it("handles DeadlineExpired revert", () => {
    const out = suggestionsForError(new Error("DeadlineExpired()"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/deadline expired/i);
  });

  it("handles FeeChangeNotReady revert", () => {
    const out = suggestionsForError(new Error("FeeChangeNotReady(1700000000)"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/timelock/i);
  });

  it("handles FeeChangeExpired revert", () => {
    const out = suggestionsForError(new Error("FeeChangeExpired()"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/expired/i);
  });

  it("handles FeeTooHigh revert (case-insensitive)", () => {
    const out = suggestionsForError(new Error("FeeToo High: 600 > 500"), MONAD_CHAIN_ID);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toMatch(/maximum/i);
  });
});

describe("suggestionsForError — new errors do not interfere with existing ones", () => {
  it("still handles market-not-found", () => {
    const out = suggestionsForError(new Error("Morpho market xyz was not found"), MONAD_CHAIN_ID);
    expect(out[0].label).toMatch(/Supported markets:/);
  });

  it("still returns [] for unrelated errors", () => {
    expect(suggestionsForError(new Error("random network error"), MONAD_CHAIN_ID)).toEqual([]);
  });
});
