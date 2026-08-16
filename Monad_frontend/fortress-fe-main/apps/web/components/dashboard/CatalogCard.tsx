"use client";

import Link from "next/link";
import type { StrategyDetail } from "@fortress/core/types";
import type { CatalogStrategy } from "@/lib/mockStrategies";
import { TokenIcon, ProtocolMark, NetworkIcon } from "../strategy/icons";

function usd(value: string) {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return "$0.00";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function gradientFor(seed: string) {
  const h = parseInt(seed.slice(2, 8) || "10b981", 16);
  return `linear-gradient(135deg, hsl(${h % 360},70%,55%), hsl(${(h + 60) % 360},70%,50%))`;
}

export function CatalogCard({ strategy }: { strategy: StrategyDetail }) {
  const protocols = Array.from(new Set(strategy.steps.map((s) => s.venue).filter(Boolean)));
  const startingToken = strategy.steps[0]?.tokenIn?.symbol ?? "USDC";
  const handle = `@${strategy.walletAddress.slice(2, 8)}`;

  // If this card has a catalogPrompt, send the user straight to the builder
  // with the prompt pre-filled and /plan auto-triggered.
  const catalogPrompt = (strategy as CatalogStrategy).catalogPrompt;
  const href = catalogPrompt
    ? `/prompt?prompt=${encodeURIComponent(catalogPrompt)}&autorun=1`
    : `/strategies/${strategy.id}`;

  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-line-soft bg-surface p-5 transition-all hover:-translate-y-1 hover:border-line"
    >
      <div className="mb-4 flex items-center justify-between">
        <span className="rounded-full border border-line-soft bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted">
          {strategy.tags[0] ?? "Strategy"}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="h-5 w-5 rounded-full" style={{ background: gradientFor(strategy.walletAddress) }} />
          <span className="mono text-[12px] text-fg-soft">{handle}</span>
          <svg className="h-3.5 w-3.5 text-green-bright" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </div>
      </div>

      <div className="mb-6 truncate text-[16px] font-bold tracking-tight transition-colors group-hover:text-green-bright">
        {strategy.name || "Untitled Strategy"}
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">APY</div>
          <div className="text-green-bright mono text-[20px] font-bold">
            {strategy.netApy > 0 ? "+" : ""}
            {strategy.netApy.toFixed(2)}%
          </div>
        </div>
        <div className="text-right">
          <div className="mb-1 text-[11px] font-medium text-muted">TVF</div>
          <div className="mono text-[16px] font-bold">{usd(strategy.valueUsd)}</div>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line-soft pt-4">
        <Meta label="Asset">
          <TokenIcon symbol={startingToken} size={18} />
        </Meta>
        <Meta label="Agent" center>
          <div className="flex -space-x-1.5">
            {(protocols.length ? protocols : ["Morpho"]).slice(0, 3).map((p, i) => (
              <ProtocolMark key={i} name={p} size={18} />
            ))}
          </div>
        </Meta>
        <Meta label="Chain" end>
          <NetworkIcon network={strategy.chainId === 8453 ? "base" : "mainnet"} size={18} />
        </Meta>
      </div>
    </Link>
  );
}

function Meta({ label, children, center, end }: { label: string; children: React.ReactNode; center?: boolean; end?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${center ? "items-center" : end ? "items-end" : ""}`}>
      <span className="text-[10px] font-medium text-faint">{label}</span>
      {children}
    </div>
  );
}
