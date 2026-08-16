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
    expect(isSupported("monad", "yield")).toBe(true);
    expect(isSupported("monad", "yield", "Morpho")).toBe(true);
    expect(isSupported("monad", "yield", "Aave")).toBe(true);
  });

  it("reports unsupported combos as false", () => {
    expect(isSupported("monad", "prediction")).toBe(false);
    expect(isSupported("solana", "yield")).toBe(false);
    expect(isSupported("monad", "yield", "Kamino")).toBe(false);
  });

  it("lists protocols for a chain+domain", () => {
    const protocols = getProtocolsForChain("monad", "yield");
    expect(protocols).toEqual(
      expect.arrayContaining(["Aave", "Neverland", "Curvance", "Euler", "Morpho", "shMONAD", "LiFi"]),
    );
  });

  it("filters capabilities by chainKey and domain", () => {
    const all = getCapabilities();
    const monadYield = getCapabilities({ chainKey: "monad", domain: "yield" });
    expect(monadYield.length).toBeGreaterThan(0);
    expect(monadYield.every((c) => c.chainKey === "monad" && c.domain === "yield")).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(monadYield.length);
  });

  it("returns only capabilities that carry a prompt fragment", () => {
    registerCapability({
      chainKey: "monad",
      domain: "yield",
      protocol: "FragmentProto",
      actions: ["deposit"],
      promptFragment: "Use FragmentProto for X.",
    });
    const fragments = getPromptFragments("monad", "yield");
    expect(fragments).toContain("Use FragmentProto for X.");
    // Capabilities without a fragment are excluded.
    expect(fragments.every((f) => typeof f === "string" && f.length > 0)).toBe(true);
  });
});
