"use client";

import { useCallback } from "react";
import { useConfig, useSendCalls, useSendTransaction } from "wagmi";
import { waitForCallsStatus, waitForTransactionReceipt } from "wagmi/actions";

// A single transaction the backend wants signed & broadcast.
export interface WalletCall {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

export interface SendPlanOptions {
  /** Fired as progress advances; `current` is 1-based. */
  onProgress?: (current: number, total: number) => void;
}

// Errors thrown by wallets that don't implement EIP-5792 wallet_sendCalls.
// EIP-1193 uses 4200 ("Unsupported Method"); JSON-RPC uses -32601.
function isSendCallsUnsupported(err: unknown): boolean {
  const anyErr = err as { code?: number; cause?: { code?: number }; name?: string } | null;
  const code = anyErr?.code ?? anyErr?.cause?.code;
  if (code === 4200 || code === -32601) return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("does not support") ||
    msg.includes("not supported") ||
    msg.includes("unsupported method") ||
    msg.includes("method not found") ||
    msg.includes("wallet_sendcalls")
  );
}

/**
 * Sends a list of plan transactions to the connected wallet.
 *
 * Primary path is EIP-5792 `wallet_sendCalls`, which batches every call into a
 * single wallet interaction. This is REQUIRED for EIP-7702 delegated accounts
 * (smart-account wallets): their legacy `eth_sendTransaction` path produces a
 * malformed raw transaction the RPC rejects with "transaction could not be
 * decoded: not enough input to decode". Batching is also atomic and needs only
 * one signature.
 *
 * Wallets without EIP-5792 fall back to the original sequential path
 * (`eth_sendTransaction` per call, waiting for each receipt).
 *
 * Returns the mined transaction hashes.
 */
export function useSendPlanCalls() {
  const config = useConfig();
  const { sendCallsAsync } = useSendCalls();
  const { sendTransactionAsync } = useSendTransaction();

  return useCallback(
    async (calls: WalletCall[], opts?: SendPlanOptions): Promise<string[]> => {
      if (calls.length === 0) return [];
      const chainId = calls[0].chainId;

      // ── Preferred: EIP-5792 batch ─────────────────────────────────────────
      try {
        opts?.onProgress?.(1, calls.length);
        const result = await sendCallsAsync({
          chainId,
          calls: calls.map((c) => ({
            to: c.to as `0x${string}`,
            data: c.data as `0x${string}`,
            value: BigInt(c.value || "0"),
          })),
        });
        // wagmi returns `{ id }` (newer) or the id string (older).
        const id = typeof result === "string" ? result : result.id;

        const { status, receipts } = await waitForCallsStatus(config, { id });
        if (status !== "success") {
          throw new Error("Batched transaction failed on-chain");
        }
        return (receipts ?? []).map((r) => r.transactionHash);
      } catch (err) {
        if (!isSendCallsUnsupported(err)) throw err;
        // else: wallet has no EIP-5792 support — fall through to legacy path.
      }

      // ── Fallback: sequential legacy sends ─────────────────────────────────
      const hashes: string[] = [];
      for (let i = 0; i < calls.length; i++) {
        opts?.onProgress?.(i + 1, calls.length);
        const c = calls[i];
        const hash = await sendTransactionAsync({
          to: c.to as `0x${string}`,
          data: c.data as `0x${string}`,
          value: BigInt(c.value || "0"),
          chainId: c.chainId,
        });
        await waitForTransactionReceipt(config, { hash, chainId: c.chainId });
        hashes.push(hash);
      }
      return hashes;
    },
    [config, sendCallsAsync, sendTransactionAsync],
  );
}
