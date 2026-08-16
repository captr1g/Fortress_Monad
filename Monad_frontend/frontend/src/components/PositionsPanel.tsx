"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useAccount } from "wagmi";
import {
  fetchPositions,
  refreshPositions,
  planExit,
  type DashboardPosition,
  type ExitPlan,
  type ExitMode,
  type ApiError,
} from "@/lib/api";
import { tokenSymbol, formatAmount } from "@/lib/tokens";
import { useSignTransactions } from "@/hooks/useSignTransactions";

const POLL_INTERVAL_MS = 10_000;

const MODE_LABELS: Record<ExitMode, string> = {
  full_to_loan: "Close → USDC",
  full_to_collateral: "Repay, keep collateral",
  deleverage: "Reduce leverage",
};

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function PositionCard({
  position,
  onExited,
}: {
  position: DashboardPosition;
  onExited: () => void;
}) {
  const { address } = useAccount();
  const sign = useSignTransactions();

  const [exitPlan, setExitPlan] = useState<ExitPlan | null>(null);
  const [building, setBuilding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [targetLtv, setTargetLtv] = useState(0.5);
  const [error, setError] = useState<string | null>(null);

  const collateralSym = tokenSymbol(position.collateralToken);
  const loanSym = tokenSymbol(position.loanToken);
  const atRisk = position.ltv > position.lltv * 0.9;

  const buildExit = useCallback(
    async (mode: ExitMode) => {
      if (!address) return;
      setBuilding(true);
      setError(null);
      setExitPlan(null);
      try {
        const plan = await planExit({
          walletAddress: address,
          market: position.marketKey,
          mode,
          targetLtv: mode === "deleverage" ? targetLtv : undefined,
        });
        setExitPlan(plan);
      } catch (err: unknown) {
        const e = err as ApiError;
        setError(e?.error?.message ?? String(err));
      } finally {
        setBuilding(false);
      }
    },
    [address, position.marketKey, targetLtv],
  );

  const confirmExit = useCallback(async () => {
    if (!exitPlan || !address) return;
    setConfirming(true);
    setError(null);
    try {
      await sign(exitPlan.transactions);
      await refreshPositions(address);
      setExitPlan(null);
      onExited();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/reject|denied/i.test(message) ? "Transaction rejected" : message);
    } finally {
      setConfirming(false);
    }
  }, [exitPlan, address, sign, onExited]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#12121a] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-200">
          {collateralSym} / {loanSym}
        </h3>
        {position.netApy !== null && (
          <span className={`text-xs ${position.netApy >= 0 ? "text-green-400" : "text-red-400"}`}>
            Net APY {pct(position.netApy)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
        <div>
          <span className="text-zinc-500">Collateral: </span>
          <span className="text-zinc-300">
            {formatAmount(position.collateral, position.collateralToken)} {collateralSym}
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Debt: </span>
          <span className="text-zinc-300">
            {formatAmount(position.debt, position.loanToken)} {loanSym}
          </span>
        </div>
        <div>
          <span className="text-zinc-500">LTV: </span>
          <span className={atRisk ? "text-red-400" : "text-zinc-300"}>{pct(position.ltv)}</span>
        </div>
        <div>
          <span className="text-zinc-500">Liq. LTV: </span>
          <span className="text-zinc-300">{pct(position.lltv)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() => buildExit("full_to_loan")}
          disabled={building || confirming}
          className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {MODE_LABELS.full_to_loan}
        </button>
        <button
          onClick={() => buildExit("full_to_collateral")}
          disabled={building || confirming}
          className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {MODE_LABELS.full_to_collateral}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => buildExit("deleverage")}
            disabled={building || confirming}
            className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700 disabled:opacity-50 transition-colors"
          >
            {MODE_LABELS.deleverage}
          </button>
          <span className="text-xs text-zinc-500">to</span>
          <input
            type="number"
            min={0}
            max={0.95}
            step={0.05}
            value={targetLtv}
            onChange={(e) => setTargetLtv(Number(e.target.value))}
            className="w-16 px-2 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 focus:outline-none"
          />
          <span className="text-xs text-zinc-500">LTV</span>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 font-mono break-all">{error}</p>}
      {building && <p className="text-xs text-zinc-500">Building exit plan…</p>}

      {exitPlan && (
        <div className="rounded-md border border-zinc-700 bg-[#0a0a0f] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-300 font-mono">{exitPlan.description}</p>
            <span
              className={`text-xs px-2 py-1 rounded-md font-medium ${
                exitPlan.simulation.success
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {exitPlan.simulation.success ? "Simulation OK" : "Simulation Failed"}
            </span>
          </div>

          {!exitPlan.simulation.success && exitPlan.simulation.error && (
            <p className="text-xs text-red-400 font-mono break-all">{exitPlan.simulation.error}</p>
          )}

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
            <div>
              <span className="text-zinc-500">Debt repaid: </span>
              <span className="text-zinc-300">
                {formatAmount(exitPlan.settlement.debtRepaid, position.loanToken)} {loanSym}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Collateral sold: </span>
              <span className="text-zinc-300">
                {formatAmount(exitPlan.settlement.collateralSold, position.collateralToken)}{" "}
                {collateralSym}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">You receive: </span>
              <span className="text-green-400">
                {formatAmount(exitPlan.settlement.expectedReceive, exitPlan.settlement.receiveToken)}{" "}
                {tokenSymbol(exitPlan.settlement.receiveToken)}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Returned: </span>
              <span className="text-zinc-300">
                {formatAmount(exitPlan.settlement.collateralReturned, position.collateralToken)}{" "}
                {collateralSym}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={confirmExit}
              disabled={confirming || !exitPlan.simulation.success}
              className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 transition-colors"
            >
              {confirming ? "Executing…" : "Confirm & Sign Exit"}
            </button>
            <button
              onClick={() => setExitPlan(null)}
              disabled={confirming}
              className="flex-1 px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PositionsPanel() {
  const { address, isConnected } = useAccount();
  const [positions, setPositions] = useState<DashboardPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const initialLoad = useRef(true);

  const load = useCallback(async () => {
    if (!address) return;
    if (initialLoad.current) setLoading(true);
    try {
      const feed = await fetchPositions(address);
      setPositions(feed.positions);
      setStale(feed.stale);
      setLoaded(true);
    } catch {
      // transient; keep last good data and let the next poll retry
    } finally {
      setLoading(false);
      initialLoad.current = false;
    }
  }, [address]);

  // On connect: force discovery once, then poll the cached feed every 10s.
  useEffect(() => {
    if (!isConnected || !address) return;
    initialLoad.current = true;
    refreshPositions(address).finally(load);
    const id = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isConnected, address, load]);

  if (!isConnected) return null;

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0a0a0f] p-5 space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Your Positions</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Live leverage positions. Exit in one signature.
          </p>
        </div>
        {stale && <span className="text-xs text-amber-400">updating…</span>}
      </div>

      {loading && <p className="text-xs text-zinc-500">Loading positions…</p>}

      {!loading && loaded && positions.length === 0 && (
        <p className="text-xs text-zinc-600">No open leverage positions.</p>
      )}

      <div className="space-y-4">
        {positions.map((p) => (
          <PositionCard key={p.marketKey} position={p} onExited={load} />
        ))}
      </div>
    </section>
  );
}
