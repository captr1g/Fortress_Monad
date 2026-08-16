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
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,  // USDC
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": 6,  // USDT
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": 18, // cbETH
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 8,  // cbBTC
  "0x2416092f143378750bb29b79ed961ab195cceea5": 18, // ezETH
  "0xecac9c5f704e954931349da37f60bb39c9223e37": 8,  // LBTC
  "0x4200000000000000000000000000000000000006": 18, // WETH
};

export const TOKEN_SYMBOLS: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": "USDT",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": "cbETH",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC",
  "0x2416092f143378750bb29b79ed961ab195cceea5": "ezETH",
  "0xecac9c5f704e954931349da37f60bb39c9223e37": "LBTC",
  "0x4200000000000000000000000000000000000006": "WETH",
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
