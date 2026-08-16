import { describe, it, expect } from "vitest";
import {
  ExitModeSchema,
  EXIT_MODE_ENUM,
  ExitRequestSchema,
} from "@domains/yield/types/exit.js";
import { WALLETS } from "../../../datasets/base.js";

describe("ExitModeSchema", () => {
  it("accepts the three known modes", () => {
    expect(ExitModeSchema.parse("full_to_loan")).toBe("full_to_loan");
    expect(ExitModeSchema.parse("full_to_collateral")).toBe("full_to_collateral");
    expect(ExitModeSchema.parse("deleverage")).toBe("deleverage");
  });

  it("rejects unknown modes", () => {
    expect(() => ExitModeSchema.parse("close_everything")).toThrow();
  });
});

describe("EXIT_MODE_ENUM", () => {
  it("maps modes to the on-chain numeric enum in order", () => {
    expect(EXIT_MODE_ENUM).toEqual({
      full_to_loan: 0,
      full_to_collateral: 1,
      deleverage: 2,
    });
  });
});

describe("ExitRequestSchema", () => {
  const base = { walletAddress: WALLETS.sample, market: "cbETH-USDC", mode: "full_to_loan" as const };

  it("accepts a minimal valid request", () => {
    expect(ExitRequestSchema.parse(base)).toMatchObject({ market: "cbETH-USDC" });
  });

  it("accepts an optional targetLtv in range", () => {
    expect(ExitRequestSchema.parse({ ...base, mode: "deleverage", targetLtv: 0.4 })).toMatchObject({
      targetLtv: 0.4,
    });
  });

  it("rejects a malformed wallet address", () => {
    expect(() => ExitRequestSchema.parse({ ...base, walletAddress: "0x123" })).toThrow();
    expect(() => ExitRequestSchema.parse({ ...base, walletAddress: "not-an-address" })).toThrow();
  });

  it("rejects an empty market and targetLtv out of [0,1]", () => {
    expect(() => ExitRequestSchema.parse({ ...base, market: "" })).toThrow();
    expect(() => ExitRequestSchema.parse({ ...base, targetLtv: 1.2 })).toThrow();
    expect(() => ExitRequestSchema.parse({ ...base, targetLtv: -0.1 })).toThrow();
  });
});
