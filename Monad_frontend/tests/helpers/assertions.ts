import { expect } from "vitest";
import type { EvmTransaction } from "@chains/evm/types.js";
import type { EvmSimulationResult } from "@chains/evm/types.js";

// Shared invariants for real, live-built transactions (the builder path — unlike
// the IR-compiler placeholder, these must always be fully populated).
export function assertWellFormedTx(tx: EvmTransaction, expectedChainId: number): void {
  expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
  expect(tx.to).not.toBe("0x0000000000000000000000000000000000000000");
  expect(tx.data).toMatch(/^0x[0-9a-fA-F]+$/);
  expect(tx.data.length).toBeGreaterThan(2); // never empty "0x"
  expect(typeof tx.value).toBe("bigint");
  expect(tx.chainId).toBe(expectedChainId);
}

export function assertWellFormedSimulation(sim: EvmSimulationResult): void {
  expect(typeof sim.success).toBe("boolean");
  expect(typeof sim.gasUsed).toBe("bigint");
  if (!sim.success) {
    // A failed simulation must explain itself.
    expect(typeof sim.error).toBe("string");
    expect((sim.error ?? "").length).toBeGreaterThan(0);
  }
}
