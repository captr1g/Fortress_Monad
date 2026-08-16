"use client";

import { useState, useCallback } from "react";
import { fortressApi, type FortressClient } from "../../api/client";
import { humanizeError } from "../../humanizeError";
import { useSendPlanCalls } from "../useSendPlanCalls";

// ─── API shapes ───────────────────────────────────────────────────────────────

export type ExitMode = "full_to_loan" | "full_to_collateral" | "deleverage";

export interface ExitRequest {
  walletAddress: string;
  market: string;
  mode: ExitMode;
  targetLtv?: number;
}

interface ExitTx {
  to: string;
  data: string;
  value: string;
  chainId: number;
}

interface ExitSettlement {
  mode: ExitMode;
  debtRepaid: string;
  collateralSold: string;
  collateralReturned: string;
  expectedReceive: string;
  receiveToken: string;
}

interface ExitSimulation {
  success: boolean;
  gasUsed: string;
  error: string | null;
}

interface ExitApiPosition {
  market: string;
  collateralToken: string;
  loanToken: string;
  collateral: string;
  debt: string;
  collateralValue: string;
  ltv: number;
  lltv: number;
}

export interface ExitPreview {
  description: string;
  transactions: ExitTx[];
  simulation: ExitSimulation;
  position: ExitApiPosition;
  settlement: ExitSettlement;
}

// ─── Phase ────────────────────────────────────────────────────────────────────

export type ExitPhase =
  | "idle"
  | "building"   // POST /exit in flight
  | "preview"    // showing preview, waiting for user confirm
  | "signing"    // sending txs one by one
  | "confirmed"  // all txs mined
  | "error";

export interface UseExitPositionResult {
  phase: ExitPhase;
  preview: ExitPreview | null;
  buildError: string | null;
  txError: string | null;
  /** Step index currently being signed (0-based) */
  txStep: number;
  build: (req: ExitRequest) => Promise<void>;
  confirm: () => Promise<void>;
  reset: () => void;
}

// ─── Token address → decimals ─────────────────────────────────────────────────

const DECIMALS: Record<string, number> = {
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": 6,  // USDC
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": 18, // WMON
  "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242": 18, // WETH
  "0x0555e30da8f98308edb960aa94c0db47230d2b9c": 8,  // WBTC
  "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b": 8,  // cbBTC
  "0xe7cd86e13ac4309349f30b3435a9d337750fc82d": 6,  // USDT0
  "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": 6,  // AUSD
  "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": 18, // shMON
};

export const TOKEN_SYMBOLS: Record<string, string> = {
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": "USDC",
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": "WMON",
  "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242": "WETH",
  "0x0555e30da8f98308edb960aa94c0db47230d2b9c": "WBTC",
  "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b": "cbBTC",
  "0xe7cd86e13ac4309349f30b3435a9d337750fc82d": "USDT0",
  "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": "AUSD",
  "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": "shMON",
};

export function formatReceive(raw: string, tokenAddress: string): string {
  const dec = DECIMALS[tokenAddress.toLowerCase()] ?? 18;
  const n = Number(raw) / 10 ** dec;
  const sym = TOKEN_SYMBOLS[tokenAddress.toLowerCase()] ?? tokenAddress.slice(0, 6) + "…";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${sym}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useExitPosition(client: FortressClient = fortressApi): UseExitPositionResult {
  const [phase, setPhase] = useState<ExitPhase>("idle");
  const [preview, setPreview] = useState<ExitPreview | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txStep, setTxStep] = useState(0);

  const sendPlanCalls = useSendPlanCalls();

  const build = useCallback(async (req: ExitRequest) => {
    setPhase("building");
    setBuildError(null);
    setTxError(null);
    setPreview(null);
    setWalletAddress(req.walletAddress);

    try {
      const data = await client.exitPosition(req);

      if (!data.simulation.success) {
        throw new Error(data.simulation.error ?? "Simulation failed");
      }

      setPreview(data);
      setPhase("preview");
    } catch (e) {
      setBuildError(humanizeError(e, "Failed to build exit"));
      setPhase("error");
    }
  }, [client]);

  const confirm = useCallback(async () => {
    if (!preview) return;
    setPhase("signing");
    setTxError(null);

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

      // Notify backend to evict the stale cache so the next positions
      // fetch returns live data without waiting for the 30s poller.
      if (walletAddress) {
        await client.refreshPositions(walletAddress).catch(() => {/* best-effort */ });
      }

      setPhase("confirmed");
    } catch (e) {
      setTxError(humanizeError(e, "Transaction failed"));
      setPhase("error");
    }
  }, [preview, walletAddress, sendPlanCalls, client]);

  const reset = useCallback(() => {
    setPhase("idle");
    setPreview(null);
    setWalletAddress(null);
    setBuildError(null);
    setTxError(null);
    setTxStep(0);
  }, []);

  return { phase, preview, buildError, txError, txStep, build, confirm, reset };
}
