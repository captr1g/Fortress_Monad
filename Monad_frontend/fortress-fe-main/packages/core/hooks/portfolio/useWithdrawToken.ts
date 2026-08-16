"use client";

import { useState, useCallback } from "react";
import { fortressApi, type FortressClient } from "../../api/client";
import { humanizeError } from "../../humanizeError";
import { useSendPlanCalls } from "../useSendPlanCalls";

// ─── API shapes ───────────────────────────────────────────────────────────────

export interface WithdrawRequest {
  walletAddress: string;
  /** ERC-20 contract address of the token to withdraw */
  tokenAddress: string;
  /** Percentage to withdraw as a string, e.g. "25", "100" */
  amount: string;
  /** Always "percent" */
  amountType: "percent";
}

interface WithdrawTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

interface WithdrawSimulation {
  success: boolean;
  gasUsed: string;
  error: string | null;
}

export interface WithdrawPreview {
  description: string;
  protocol: string;
  shares: string;
  minUsdcOut: string;
  transactions: WithdrawTx[];
  simulation: WithdrawSimulation;
}

// ─── Phase ────────────────────────────────────────────────────────────────────

export type WithdrawPhase =
  | "idle"
  | "building"   // POST /fortress/withdraw in flight
  | "preview"    // simulation passed — waiting for user to confirm
  | "signing"    // sending txs one by one
  | "confirmed"  // all txs sent
  | "error";

export interface UseWithdrawTokenResult {
  phase: WithdrawPhase;
  preview: WithdrawPreview | null;
  txStep: number;
  txCount: number;
  error: string | null;
  build: (req: WithdrawRequest) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWithdrawToken(client: FortressClient = fortressApi): UseWithdrawTokenResult {
  const [phase, setPhase] = useState<WithdrawPhase>("idle");
  const [preview, setPreview] = useState<WithdrawPreview | null>(null);
  const [txStep, setTxStep] = useState(0);
  const [txCount, setTxCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);

  const sendPlanCalls = useSendPlanCalls();

  // ── Step 1: call the endpoint, check simulation, expose preview ──
  const build = useCallback(async (req: WithdrawRequest) => {
    setPhase("building");
    setError(null);
    setPreview(null);
    setTxStep(0);
    setWalletAddress(req.walletAddress);

    try {
      const data = await client.withdrawToken(req);

      if (!data.simulation.success) {
        throw new Error(data.simulation.error ?? "Simulation failed");
      }

      setPreview(data);
      setTxCount(data.transactions.length);
      setPhase("preview");
    } catch (e) {
      setError(humanizeError(e, "Failed to build withdrawal"));
      setPhase("error");
    }
  }, [client]);

  // ── Step 2: user confirmed — sign all transactions ──
  const confirm = useCallback(async () => {
    if (!preview) return;
    setPhase("signing");
    setError(null);

    try {
      // EIP-5792 batch (with legacy fallback) — required for EIP-7702
      // smart-account wallets. See useSendPlanCalls.
      await sendPlanCalls(
        preview.transactions.map((tx) => ({
          to: tx.to,
          data: tx.data,
          value: tx.value ?? "0",
          chainId: tx.chainId,
        })),
        { onProgress: (current) => setTxStep(current - 1) },
      );
      if (walletAddress) {
        await client.refreshPositions(walletAddress).catch(() => {/* best-effort */ });
      }
      setPhase("confirmed");
    } catch (e) {
      setError(humanizeError(e, "Transaction failed"));
      setPhase("error");
    }
  }, [preview, walletAddress, sendPlanCalls, client]);

  const reset = useCallback(() => {
    setPhase("idle");
    setPreview(null);
    setTxStep(0);
    setTxCount(0);
    setError(null);
    setWalletAddress(null);
  }, []);

  return { phase, preview, txStep, txCount, error, build, confirm, reset };
}
