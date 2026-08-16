import { describe, it, expect, beforeAll } from "vitest";
import {
  getChain,
  getChainById,
  getChainByKey,
  listChains,
  findToken,
  findTokenById,
  tokenAddress,
} from "@core/registry/index.js";
import { seedRegistry } from "../../../helpers/registry.js";
import { TOKENS, BASE_CHAIN_ID } from "../../../datasets/base.js";

beforeAll(() => seedRegistry());

describe("chain registry lookups", () => {
  it("finds Base by key and by id, and getChain aliases getChainById", () => {
    const byKey = getChainByKey("base");
    const byId = getChainById(BASE_CHAIN_ID);
    expect(byKey?.chainId).toBe(BASE_CHAIN_ID);
    expect(byId?.chainKey).toBe("base");
    expect(getChain(BASE_CHAIN_ID)).toBe(byId);
  });

  it("returns undefined for unknown chains", () => {
    expect(getChainByKey("dogechain")).toBeUndefined();
    expect(getChainById(999999)).toBeUndefined();
    expect(getChain(0)).toBeUndefined();
  });

  it("lists all registered chains", () => {
    const keys = listChains().map((c) => c.chainKey);
    expect(keys).toContain("base");
    expect(keys).toContain("ethereum");
  });
});

describe("token lookups", () => {
  it("finds a token by symbol (case-insensitive)", () => {
    expect(findToken("base", "usdc")?.address).toBe(TOKENS.USDC);
    expect(findToken("base", "USDC")?.address).toBe(TOKENS.USDC);
  });

  it("finds a token by address (case-insensitive)", () => {
    expect(findToken("base", TOKENS.WETH.toLowerCase())?.symbol).toBe("WETH");
  });

  it("returns undefined for unknown token or unknown chain", () => {
    expect(findToken("base", "NOTATOKEN")).toBeUndefined();
    expect(findToken("nochain", "USDC")).toBeUndefined();
  });

  it("findTokenById mirrors findToken via chainId", () => {
    expect(findTokenById(BASE_CHAIN_ID, "cbETH")?.address).toBe(TOKENS.cbETH);
  });

  it("tokenAddress returns the checksummed address or undefined", () => {
    expect(tokenAddress(BASE_CHAIN_ID, "USDC")).toBe(TOKENS.USDC);
    expect(tokenAddress(BASE_CHAIN_ID, "NOPE")).toBeUndefined();
  });
});
