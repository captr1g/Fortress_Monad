"use client";

import Link from "next/link";
import type { StrategyDetail } from "@fortress/core/types";

const statusColors = {
  monitoring: "bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/20",
  entered: "bg-green/10 text-green border-green/20",
  exit_pending: "bg-amber/10 text-amber border-amber/20",
  exited: "bg-line text-muted border-line-soft",
  failed: "bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/20",
} as const;

const statusLabel = {
  monitoring: "Monitoring",
  entered: "Active",
  exit_pending: "Exiting",
  exited: "Exited",
  failed: "Failed",
} as const;

function usd(value: string) {
  return `$${parseFloat(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function StrategyCard({ strategy }: { strategy: StrategyDetail }) {
  const pnl = parseFloat(strategy.pnlUsd);

  return (
    <Link
      href={`/strategies/${strategy.id}`}
      className="group flex flex-col rounded-xl border border-line-soft bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-line"
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="truncate text-[15px] font-semibold">{strategy.name || "Untitled Strategy"}</div>
        <div className={`flex flex-none items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${statusColors[strategy.status]}`}>
          {statusLabel[strategy.status]}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <div>
          <div className="mb-1 text-[11px] text-muted">Net APY</div>
          <div className="mono text-[16px] font-semibold text-green">
            {strategy.netApy > 0 ? "+" : ""}{strategy.netApy.toFixed(2)}%
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-[11px] text-muted">Value</div>
          <div className="mono text-[16px] font-semibold">{usd(strategy.valueUsd)}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line-soft pt-3 text-[12px]">
        <span className={`mono ${pnl >= 0 ? "text-green" : "text-[#ef4444]"}`}>
          {pnl > 0 ? "+" : ""}{usd(strategy.pnlUsd)} PnL
        </span>
        <span className="flex items-center gap-1 text-faint transition-colors group-hover:text-fg-soft">
          View
          <span className="transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </div>
    </Link>
  );
}
