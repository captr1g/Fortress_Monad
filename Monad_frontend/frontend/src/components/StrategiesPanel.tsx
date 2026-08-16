"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchStrategies, type StrategyListItem } from "@/lib/api";

const POLL_INTERVAL_MS = 30_000;

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function StrategyCard({
  strategy,
  onTry,
}: {
  strategy: StrategyListItem;
  onTry: (prompt: string) => void;
}) {
  const net = strategy.netApy;
  const netColor =
    net === null ? "text-zinc-500" : net >= 0 ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#12121a] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">{strategy.title}</h3>
          <p className="text-xs text-zinc-500 mt-1">{strategy.summary}</p>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-lg font-bold ${netColor}`}>{pct(net)}</div>
          <div className="text-[10px] text-zinc-500 uppercase tracking-wide">Net APY</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs font-mono">
        <div>
          <span className="text-zinc-500">Collateral: </span>
          <span className="text-green-400">
            {strategy.collateralApy !== null ? `+${pct(strategy.collateralApy)}` : "—"}
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Borrow: </span>
          <span className="text-red-400">
            {strategy.borrowApy !== null ? `-${pct(strategy.borrowApy)}` : "—"}
          </span>
        </div>
        <div>
          <span className="text-zinc-500">Leverage: </span>
          <span className="text-zinc-300">
            {strategy.leverage !== null ? `${strategy.leverage.toFixed(2)}×` : "—"}
          </span>
        </div>
      </div>

      {strategy.status === "pending" && (
        <p className="text-xs text-zinc-500">Building strategy…</p>
      )}
      {strategy.status === "error" && (
        <p className="text-xs text-red-400 font-mono break-all">
          {strategy.error ?? "Build failed"}
        </p>
      )}
      {strategy.status === "unavailable" && (
        <p className="text-xs text-amber-400">Live rates unavailable right now.</p>
      )}

      <button
        onClick={() => onTry(strategy.prompt)}
        className="w-full px-3 py-2 rounded-md bg-zinc-800 text-zinc-200 text-xs font-medium hover:bg-zinc-700 transition-colors"
      >
        Try this strategy
      </button>
    </div>
  );
}

export function StrategiesPanel({ onTry }: { onTry: (prompt: string) => void }) {
  const [strategies, setStrategies] = useState<StrategyListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    setError(null);
    try {
      const feed = await fetchStrategies();
      setStrategies(feed.strategies);
    } catch (err: unknown) {
      const e = err as { error?: { message?: string } };
      setError(e?.error?.message ?? "Failed to load strategies");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  // Initial load, then poll so net APY tracks the backend rate refresh.
  useEffect(() => {
    load(true);
    const id = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-[#0a0a0f] p-5 space-y-4 mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Strategy Catalog</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Curated leverage strategies with live net APY. Click to load into the prompt.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-xs text-red-400 font-mono break-all">{error}</p>}
      {loading && strategies.length === 0 && (
        <p className="text-xs text-zinc-500">Loading strategies…</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {strategies.map((s) => (
          <StrategyCard key={s.id} strategy={s} onTry={onTry} />
        ))}
      </div>
    </section>
  );
}
