import { describe, it, expect } from "vitest";
import {
  InputTokenMismatch,
  UnsupportedAmountOverride,
} from "@shared/errors.js";

describe("InputTokenMismatch", () => {
  it("is an Error with the symbol and address preserved", () => {
    const err = new InputTokenMismatch("WETH", "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InputTokenMismatch");
    expect(err.symbol).toBe("WETH");
    expect(err.address).toBe("0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242");
  });

  it("mentions the symbol twice in the guidance message", () => {
    const err = new InputTokenMismatch("WETH", "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242");
    expect(err.message).toContain("WETH");
    // Message tells the user how to fix it.
    expect(err.message.toLowerCase()).toMatch(/mention|switch/);
  });

  it("is catchable as its concrete type via instanceof", () => {
    try {
      throw new InputTokenMismatch("USDC", "0x0");
    } catch (e) {
      expect(e instanceof InputTokenMismatch).toBe(true);
    }
  });
});

describe("UnsupportedAmountOverride", () => {
  it("names the offending action in the message", () => {
    const err = new UnsupportedAmountOverride("leverage");
    expect(err.name).toBe("UnsupportedAmountOverride");
    expect(err.message).toContain("leverage");
  });

  it("is an Error subclass", () => {
    expect(new UnsupportedAmountOverride("strategy")).toBeInstanceOf(Error);
  });
});
