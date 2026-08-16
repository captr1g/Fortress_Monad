import { describe, it, expect, beforeAll } from "vitest";
import {
  getCapabilities,
  isSupported,
  getProtocolsForChain,
  getPromptFragments,
  registerCapability,
} from "@core/registry/index.js";
import { seedRegistry } from "../../../helpers/registry.js";

beforeAll(() => seedRegistry());

describe("capability matrix", () => {
  it("reports supported (chain, domain) and (chain, domain, protocol) combos", () => {
    expect(isSupported("base", "yield")).toBe(true);
    expect(isSupported("base", "yield", "Morpho")).toBe(true);
    expect(isSupported("base", "yield", "Pendle")).toBe(true);
  });

  it("reports unsupported combos as false", () => {
    expect(isSupported("base", "prediction")).toBe(false);
    expect(isSupported("solana", "yield")).toBe(false);
    expect(isSupported("base", "yield", "Kamino")).toBe(false);
  });

  it("lists protocols for a chain+domain", () => {
    const protocols = getProtocolsForChain("base", "yield");
    expect(protocols).toEqual(
      expect.arrayContaining(["Morpho", "Aave", "Fluid", "Euler", "CompoundV3", "Pendle", "LiFi"]),
    );
  });

  it("filters capabilities by chainKey and domain", () => {
    const all = getCapabilities();
    const baseYield = getCapabilities({ chainKey: "base", domain: "yield" });
    expect(baseYield.length).toBeGreaterThan(0);
    expect(baseYield.every((c) => c.chainKey === "base" && c.domain === "yield")).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(baseYield.length);
  });

  it("returns only capabilities that carry a prompt fragment", () => {
    registerCapability({
      chainKey: "base",
      domain: "yield",
      protocol: "FragmentProto",
      actions: ["deposit"],
      promptFragment: "Use FragmentProto for X.",
    });
    const fragments = getPromptFragments("base", "yield");
    expect(fragments).toContain("Use FragmentProto for X.");
    // Capabilities without a fragment are excluded.
    expect(fragments.every((f) => typeof f === "string" && f.length > 0)).toBe(true);
  });
});
