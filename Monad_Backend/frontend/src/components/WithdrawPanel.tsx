"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import {
  withdrawVault,
  refreshPositions,
  type WithdrawResult,
  type ApiError,
} from "@/lib/api";
import { useSignTransactions } from "@/hooks/useSignTransactions";

const KNOWN_VAULTS: { name: string; address: string }[] = [
  { name: "Morpho", address: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca" },
  { name: "Aave", address: "0xC768c589647798a6EE01A91FdE98EF2ed046DBD6" },
];

type AmountType = "usdc" | "shares" | "percent" | "all";

const AMOUNT_TYPE_LABELS: Record<AmountType, string> = {
  usdc: "USDC",
  shares: "Shares",
  percent: "Percent",
  all: "All",
};

const AMOUNT_PLACEHOLDERS: Record<AmountType, string> = {
  usdc: "e.g. 1000000 (1 USDC)",
  shares: "Raw share units",
  percent: "1–100",
  all: "",
};

export function WithdrawPanel() {
  const { address, isConnected } = useAccount();
  const sign = useSignTransactions();

  const [tokenAddress, setTokenAddress] = useState(KNOWN_VAULTS[0].address);
  const [amount, setAmount] = useState("");
  const [amountType, setAmountType] = useState<AmountType>("usdc");
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const [building, setBuilding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);

  const handleBuild = useCallback(async () => {
    if (!address) return;
    setBuilding(true);
    setError(null);
    setResult(null);
    setTxHashes([]);

    try {
      const res = await withdrawVault({
        walletAddress: address,
        tokenAddress,
        amount: amountType === "all" ? "0" : amount,
        amountType,
      });
      setResult(res);
    } catch (err: unknown) {
      const e = err as ApiError;
      setError(e?.error?.message ?? String(err));
    } finally {
      setBuilding(false);
    }
  }, [address, tokenAddress, amount, amountType]);

  const handleConfirm = useCallback(async () => {
    if (!result || !address) return;
    setConfirming(true);
    setError(null);
    try {
      const hashes = await sign(result.transactions);
      setTxHashes(hashes);
      await refreshPositions(address);
      setResult(null);
      setAmount("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/reject|denied/i.test(message) ? "Transaction rejected" : message);
    } finally {
      setConfirming(false);
    }
  }, [result, address, sign]);

  if (!isConnected) return null;

  const selectedVault = KNOWN_VAULTS.find(
    (v) => v.address.toLowerCase() === tokenAddress.toLowerCase(),
  );
  const needsAmount = amountType !== "all";

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0a0a0f] p-5 space-y-4 mb-6">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">
          Withdraw from Vault
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          Redeem vault shares directly — no prompt needed.
        </p>
      </div>

      <div className="space-y-3">
        {/* Protocol selector */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">Protocol</label>
          <div className="flex gap-2">
            {KNOWN_VAULTS.map((v) => (
              <button
                key={v.address}
                onClick={() => setTokenAddress(v.address)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tokenAddress.toLowerCase() === v.address.toLowerCase()
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
        </div>

        {/* Custom token address */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Token Address
            {selectedVault && (
              <span className="text-zinc-600 ml-1">({selectedVault.name})</span>
            )}
          </label>
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            placeholder="0x..."
            className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Amount type selector */}
        <div>
          <label className="block text-xs text-zinc-400 mb-1">
            Withdraw By
          </label>
          <div className="flex gap-1.5">
            {(Object.keys(AMOUNT_TYPE_LABELS) as AmountType[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setAmountType(t);
                  setResult(null);
                }}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  amountType === t
                    ? "bg-indigo-600 text-white"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                }`}
              >
                {AMOUNT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {/* Amount input (hidden when "all") */}
        {needsAmount && (
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Amount
              {amountType === "percent" && (
                <span className="text-zinc-600 ml-1">(1–100%)</span>
              )}
            </label>
            <input
              type="text"
              value={amount}
              onChange={(e) => {
                const val = amountType === "percent"
                  ? e.target.value.replace(/[^\d.]/g, "")
                  : e.target.value.replace(/[^\d]/g, "");
                setAmount(val);
              }}
              placeholder={AMOUNT_PLACEHOLDERS[amountType]}
              className="w-full px-3 py-2 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <p className="text-[10px] text-zinc-600 mt-1">
              {amountType === "usdc" && "Raw USDC units (6 decimals). 1 USDC = 1000000."}
              {amountType === "shares" && "Raw vault share units."}
              {amountType === "percent" && "Percentage of your share balance to withdraw."}
            </p>
          </div>
        )}

        {/* Build button */}
        <button
          onClick={handleBuild}
          disabled={building || confirming || (needsAmount && !amount)}
          className="w-full px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50 transition-colors"
        >
          {building ? "Building…" : amountType === "all" ? "Withdraw All" : "Build Withdraw"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-400 font-mono break-all">{error}</p>
      )}

      {/* Success hashes */}
      {txHashes.length > 0 && (
        <div className="rounded-md border border-green-800/30 bg-green-500/5 p-3 space-y-1">
          <p className="text-xs text-green-400 font-medium">
            ✅ {txHashes.length} transaction(s) confirmed
          </p>
          {txHashes.map((h, i) => (
            <p key={i} className="text-[10px] text-zinc-400 font-mono break-all">
              {h}
            </p>
          ))}
        </div>
      )}

      {/* Preview */}
      {result && (
        <div className="rounded-md border border-zinc-700 bg-[#12121a] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-300 font-mono">
              {result.description}
            </p>
            <span
              className={`text-xs px-2 py-1 rounded-md font-medium ${
                result.simulation.success
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {result.simulation.success ? "Simulation OK" : "Sim Failed"}
            </span>
          </div>

          {!result.simulation.success && result.simulation.error && (
            <p className="text-xs text-red-400 font-mono break-all">
              {result.simulation.error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
            <div>
              <span className="text-zinc-500">Protocol: </span>
              <span className="text-zinc-300">{result.protocol}</span>
            </div>
            <div>
              <span className="text-zinc-500">Shares: </span>
              <span className="text-zinc-300">{result.shares}</span>
            </div>
            <div>
              <span className="text-zinc-500">Min USDC out: </span>
              <span className="text-green-400">{result.minUsdcOut}</span>
            </div>
            <div>
              <span className="text-zinc-500">Gas: </span>
              <span className="text-zinc-300">{result.simulation.gasUsed}</span>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={handleConfirm}
              disabled={confirming || !result.simulation.success}
              className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {confirming ? "Executing…" : "Confirm & Sign"}
            </button>
            <button
              onClick={() => setResult(null)}
              disabled={confirming}
              className="flex-1 px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
