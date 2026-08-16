import type { PlanResult } from "../orchestrator.js";
import type { EvmTransaction } from "@chains/evm/types.js";

export type SerializedTransaction = {
  to: string;
  data: string;
  value: string;
  chainId: number;
};

export function serializePlanResult(result: PlanResult) {
  return {
    intent: result.intent,
    description: result.description,
    transactions: result.transactions.map(serializeTransaction),
    simulation: {
      success: result.simulation.success,
      gasUsed: result.simulation.gasUsed.toString(),
      error: result.simulation.error ?? null,
    },
    apy: result.apy ?? null,
    depositApy: result.depositApy ?? null,
  };
}

export function serializeTransaction(tx: EvmTransaction): SerializedTransaction {
  return {
    to: tx.to,
    data: tx.data,
    value: tx.value.toString(),
    chainId: tx.chainId,
  };
}
