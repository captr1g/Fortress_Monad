import { describe, it, expect } from "vitest";
import {
  serializePlanResult,
  serializeTransaction,
} from "@core/api/serializers.js";
import type { EvmTransaction } from "@chains/evm/types.js";
import type { PlanResult } from "@core/orchestrator.js";
import { TOKENS } from "../../../datasets/base.js";

const tx: EvmTransaction = {
  to: TOKENS.USDC,
  data: "0x095ea7b3",
  value: 12345678901234567890n,
  chainId: 8453,
};

describe("serializeTransaction", () => {
  it("stringifies bigint value and keeps other fields", () => {
    const s = serializeTransaction(tx);
    expect(s).toEqual({
      to: TOKENS.USDC,
      data: "0x095ea7b3",
      value: "12345678901234567890",
      chainId: 8453,
    });
    expect(typeof s.value).toBe("string");
  });

  it("serializes a zero value as '0'", () => {
    expect(serializeTransaction({ ...tx, value: 0n }).value).toBe("0");
  });
});

describe("serializePlanResult", () => {
  const result = {
    intent: { action: "deposit", amount: "1000000" },
    description: "Deposit 1000000 USDC",
    transactions: [tx, { ...tx, value: 0n }],
    simulation: { success: true, gasUsed: 245000n, error: undefined },
    apy: undefined,
    depositApy: undefined,
  } as unknown as PlanResult;

  it("maps every transaction and stringifies gasUsed", () => {
    const s = serializePlanResult(result);
    expect(s.transactions).toHaveLength(2);
    expect(s.simulation.gasUsed).toBe("245000");
    expect(s.simulation.success).toBe(true);
  });

  it("normalizes a missing error to null", () => {
    const s = serializePlanResult(result);
    expect(s.simulation.error).toBeNull();
  });

  it("normalizes apy and depositApy to null when undefined", () => {
    const s = serializePlanResult(result);
    expect(s.apy).toBeNull();
    expect(s.depositApy).toBeNull();
  });

  it("passes the intent through untouched", () => {
    const s = serializePlanResult(result);
    expect(s.intent).toEqual({ action: "deposit", amount: "1000000" });
  });

  it("produces a fully JSON-serializable object (no bigint leaks)", () => {
    const s = serializePlanResult(result);
    expect(() => JSON.stringify(s)).not.toThrow();
  });
});
