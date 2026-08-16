"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStrategy } from "@fortress/core/hooks";
import type { StrategyDetail as StrategyDetailType, StrategyStep } from "@fortress/core/types";
import { formatApy, formatTokenAmount } from "@/lib/format";
import { findMockStrategy } from "@/lib/mockStrategies";
import { TopBar } from "./TopBar";
import { TokenIcon, ProtocolMark, NetworkIcon } from "./icons";
import { WalletGate } from "@/components/auth/WalletGate";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { getExplorerUrl, chainIdToNetwork } from "@/lib/chains";

const STATUS: Record<string, { label: string; cls: string }> = {
  monitoring: { label: "Monitoring", cls: "border-[#3b82f6]/25 bg-[#3b82f6]/10 text-[#60a5fa]" },
  entered: { label: "Active", cls: "border-green/25 bg-green/10 text-green-bright" },
  exit_pending: { label: "Exiting", cls: "border-amber/25 bg-amber/10 text-amber" },
  exited: { label: "Exited", cls: "border-line bg-line text-muted" },
  failed: { label: "Failed", cls: "border-[#ef4444]/25 bg-[#ef4444]/10 text-[#ef4444]" },
};

function usd(value: string) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return value;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortHash(hash: string) {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

function gradientFor(seed: string) {
  const h = parseInt(seed.slice(2, 8) || "10b981", 16);
  return `linear-gradient(135deg, hsl(${h % 360},70%,55%), hsl(${(h + 60) % 360},70%,50%))`;
}

export function StrategyDetail({ id }: { id: string }) {
  const mock = findMockStrategy(id);
  const { data, isLoading, isError } = useStrategy(mock ? undefined : id);
  const strategy = mock ?? data;

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />
      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/strategies"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted transition-colors hover:text-fg"
        >
          <span className="text-[16px] leading-none">‹</span> Go back
        </Link>

        {!mock && isLoading ? (
          <DetailSkeleton />
        ) : !strategy || isError ? (
          <NotFoundState />
        ) : (
          <Detail strategy={strategy} />
        )}
      </main>
    </div>
  );
}

function Detail({ strategy }: { strategy: StrategyDetailType }) {
  const badge = STATUS[strategy.status] ?? STATUS.monitoring;
  const handle = `@${strategy.walletAddress.slice(2, 8)}`;
  const startingToken = strategy.steps[0]?.tokenIn?.symbol ?? "USDC";

  return (
    <div style={{ animation: "ffadein .35s ease both" }}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[21px] font-bold tracking-tight sm:text-[26px]">{strategy.name || "Untitled strategy"}</h1>
            <VerifiedBadge />
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[12.5px] text-muted">
            <span className="h-5 w-5 rounded-full" style={{ background: gradientFor(strategy.walletAddress) }} />
            <span className="font-medium text-fg-soft">{handle}</span>
            <span className="text-faint">·</span>
            <span>Created {new Date(strategy.deployedAt).toLocaleDateString()}</span>
          </div>
        </div>
        {strategy.txHashes[0] && (
          <a
            href={getExplorerUrl(strategy.chainId ?? 143, strategy.txHashes[0])}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-4 text-[13px] font-medium text-fg-soft transition-colors hover:bg-surface-2"
          >
            View on Explorer ↗
          </a>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
          <ApyCard strategy={strategy} />
          <ActionPanel startingToken={startingToken} gasSpentUsd={strategy.gasSpentUsd} />
        </aside>

        <RightPanel strategy={strategy} startingToken={startingToken} />
      </div>
    </div>
  );
}

/* ---------------- Left column ---------------- */

function ApyCard({ strategy }: { strategy: StrategyDetailType }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-5">
      <div className="mb-4 flex items-baseline gap-2">
        <span className="text-[12px] font-medium text-muted">APY</span>
        <span className="text-green-bright text-[26px] font-bold leading-none">{strategy.netApy.toFixed(2)}%</span>
      </div>
      <ApyChart seed={strategy.netApy} />
    </div>
  );
}

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RANGES = ["1D", "7D", "30D"] as const;

function ApyChart({ seed }: { seed: number }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30D");

  const { line, area, avg, peak } = useMemo(() => {
    const n = range === "1D" ? 24 : range === "7D" ? 28 : 30;
    const rand = mulberry32(Math.round(seed * 100) + RANGES.indexOf(range) * 7919);
    const w = 300;
    const h = 120;
    let v = 0.45;
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      v += (rand() - 0.42) * 0.12;
      v = Math.max(0.08, Math.min(0.95, v));
      // trend upward toward the end
      v += (i / n) * 0.004;
      ys.push(v);
    }
    const max = Math.max(...ys);
    const pts = ys.map((y, i) => {
      const x = (i / (n - 1)) * w;
      const py = h - (y / 1) * (h - 8) - 4;
      return [x, py] as const;
    });
    const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const area = `${line} L${w},${h} L0,${h} Z`;
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const meanY = h - mean * (h - 8) - 4;
    return { line, area, avg: meanY, peak: max };
  }, [seed, range]);

  return (
    <div>
      <div className="mb-2 flex justify-end gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
              range === r ? "bg-surface-2 text-fg" : "text-faint hover:text-muted"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <svg viewBox="0 0 300 120" className="h-[120px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="apyArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-green)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--color-green)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#apyArea)" />
        <path d={line} fill="none" stroke="var(--color-green-bright)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1="0" y1={avg} x2="300" y2={avg} stroke="var(--color-faint)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
      </svg>
      <div className="mt-1.5 flex justify-between text-[10px] text-faint">
        <span>{range === "30D" ? "30 days ago" : range === "7D" ? "7 days ago" : "24h ago"}</span>
        <span>now</span>
      </div>
      <span className="hidden">{peak}</span>
    </div>
  );
}

function ActionPanel({ startingToken, gasSpentUsd }: { startingToken: string; gasSpentUsd: string }) {
  const [amount, setAmount] = useState("");
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold">Deposit</span>
        <span className="text-[11px] text-faint">
          Available: <span className="text-muted">0.00 {startingToken}</span>
        </span>
      </div>

      <div className="mb-3 flex items-center gap-3 rounded-xl border border-line-soft bg-surface-2 px-3.5 py-3">
        <TokenIcon symbol={startingToken} size={24} />
        <span className="text-[14px] font-medium">{startingToken}</span>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          inputMode="decimal"
          placeholder="0.00"
          className="mono ml-auto w-full bg-transparent text-right text-[15px] text-fg outline-none placeholder:text-faint"
        />
        <button
          onClick={() => setAmount("1000")}
          className="rounded-md bg-line px-2 py-1 text-[10.5px] font-semibold text-fg-soft transition-colors hover:bg-elevated"
        >
          MAX
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-2 text-[12px]">
        <div className="flex justify-between">
          <span className="text-muted">Est. network cost</span>
          <span className="mono text-fg-soft">{usd(gasSpentUsd)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Slippage tolerance</span>
          <span className="mono text-fg-soft">1%</span>
        </div>
      </div>

      <button className="mb-2.5 h-11 w-full rounded-lg border border-line bg-surface-2 text-[13.5px] font-semibold text-fg-soft transition-colors hover:bg-elevated">
        Simulate
      </button>
      <WalletGate connectLabel="Connect wallet to deploy">
        <PrimaryButton>Deploy this strategy</PrimaryButton>
      </WalletGate>
    </div>
  );
}

/* ---------------- Right column ---------------- */

const TABS = ["Overview", "Strategy prompt", "Activity"] as const;

function RightPanel({ strategy, startingToken }: { strategy: StrategyDetailType; startingToken: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");

  return (
    <section>
      <div className="mb-5 flex gap-1 rounded-xl border border-line-soft bg-surface-2 p-1">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-4 py-2 text-[13px] font-medium transition-colors ${
              tab === t ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg-soft"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <Overview strategy={strategy} startingToken={startingToken} />}
      {tab === "Strategy prompt" && <PromptTab strategy={strategy} />}
      {tab === "Activity" && <ActivityTab events={strategy.history} chainId={strategy.chainId} />}
    </section>
  );
}

function Overview({ strategy, startingToken }: { strategy: StrategyDetailType; startingToken: string }) {
  const protocols = Array.from(new Set(strategy.steps.map((s) => s.venue).filter(Boolean)));
  const depositApy = strategy.steps.reduce((a, s) => a + (s.apy?.kind === "yield" ? s.apy.value : 0), 0);
  const borrowApy = strategy.steps.reduce((a, s) => a + (s.apy?.kind === "cost" ? s.apy.value : 0), 0);
  const pnl = Number.parseFloat(strategy.pnlUsd);

  return (
    <div className="flex flex-col gap-4" style={{ animation: "ffadein .25s ease both" }}>
      {/* metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Net APY"><span className="text-green-bright">{strategy.netApy.toFixed(2)}%</span></Metric>
        <Metric label="Position value">{usd(strategy.valueUsd)}</Metric>
        <Metric label="Deposited">{usd(strategy.depositUsd)}</Metric>
        <Metric label="PnL">
          <span className={pnl >= 0 ? "text-green" : "text-[#ef4444]"}>
            {pnl > 0 ? "+" : ""}
            {usd(strategy.pnlUsd)}
          </span>
        </Metric>
      </div>

      {/* non-custody */}
      <div className="flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface px-4 py-3 text-[12.5px] text-muted">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green/10 text-green-bright">🛈</span>
        Fortress never takes custody of your assets. Funds stay under your control.
      </div>

      {/* executed via */}
      {protocols.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface px-4 py-3">
          <span className="text-[12.5px] text-muted">Executed via</span>
          <div className="flex flex-wrap gap-2">
            {protocols.map((p) => (
              <span key={p} className="flex items-center gap-1.5 rounded-full border border-line-soft bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-fg-soft">
                <ProtocolMark name={p} size={16} /> {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* flow + breakdown */}
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_220px]">
        <StrategyFlow strategy={strategy} startingToken={startingToken} />
        <div className="flex flex-col gap-3">
          <Breakdown depositApy={depositApy} borrowApy={borrowApy} steps={strategy.steps.length} />
          <div className="rounded-2xl border border-line-soft bg-surface p-4 text-[12.5px] text-muted">
            <div className="mb-1 flex items-center gap-1.5 font-medium text-fg-soft">⤴ Auto-exit</div>
            {strategy.status === "exited"
              ? `Exited ${strategy.exitedAt ? new Date(strategy.exitedAt).toLocaleDateString() : ""}`
              : strategy.exitCondition
                ? <>Exits automatically when <span className="text-fg-soft">{strategy.exitCondition}</span>.</>
                : "Entry and exit run autonomously."}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface px-4 py-3">
      <div className="mb-1 text-[11px] text-muted">{label}</div>
      <div className="mono text-[18px] font-semibold leading-none">{children}</div>
    </div>
  );
}

function Breakdown({ depositApy, borrowApy, steps }: { depositApy: number; borrowApy: number; steps: number }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-muted">APY</span>
        <span className="text-green-bright text-[20px] font-bold leading-none">{(depositApy + borrowApy).toFixed(2)}%</span>
      </div>
      <div className="flex flex-col gap-2 border-t border-line-soft pt-3 text-[12.5px]">
        <Row label="Deposit APY"><span className="mono text-green">+{depositApy.toFixed(2)}%</span></Row>
        <Row label="Borrow APY"><span className="mono text-amber">−{borrowApy.toFixed(2)}%</span></Row>
        <Row label="No. of steps"><span className="mono text-fg-soft">{steps}</span></Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

function StrategyFlow({ strategy, startingToken }: { strategy: StrategyDetailType; startingToken: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface-2">
      <div className="flex items-center gap-2 border-b border-line-soft bg-surface px-4 py-3">
        <NetworkIcon network={chainIdToNetwork(strategy.chainId)} size={18} />
        <span className="text-[12.5px] font-semibold">{strategy.chainId === 8453 ? "Base" : (strategy.chainId === 1 ? "Ethereum" : "Monad")}</span>
        <span className="mono ml-auto text-[11.5px] text-faint">{strategy.steps.length} actions</span>
      </div>

      <div className="flex flex-col gap-0 p-4">
        <div className="rounded-xl border border-line-soft bg-surface px-4 py-3">
          <div className="mb-1 text-[11px] text-muted">Starting token</div>
          <div className="flex items-center gap-2">
            <TokenIcon symbol={startingToken} size={20} />
            <span className="text-[14px] font-medium">{startingToken}</span>
          </div>
        </div>

        {strategy.steps.map((step, i) => (
          <FlowStep key={`${step.index}-${i}`} step={step} />
        ))}
      </div>
    </div>
  );
}

function FlowStep({ step }: { step: StrategyStep }) {
  const apy = step.apy ? formatApy(step.apy.value, step.apy.kind) : null;
  return (
    <div>
      <div className="flex justify-center py-1.5 text-faint">↓</div>
      <div className="flex items-center gap-3 rounded-xl border border-line-soft bg-surface px-4 py-3">
        <ProtocolMark name={step.venue} size={26} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] font-medium">
            <span>{step.action}</span>
            {step.tokenIn && (
              <span className="flex items-center gap-1.5 text-muted">
                <TokenIcon symbol={step.tokenIn.symbol} size={15} />
                <span className="mono text-[12px]">
                  {formatTokenAmount(step.tokenIn.amount, step.tokenIn.decimals)} {step.tokenIn.symbol}
                </span>
              </span>
            )}
            {step.tokenOut && step.tokenOut.symbol && (
              <>
                <span className="text-faint">→</span>
                <span className="flex items-center gap-1.5 text-muted">
                  <TokenIcon symbol={step.tokenOut.symbol} size={15} />
                  <span className="mono text-[12px]">{step.tokenOut.symbol}</span>
                </span>
              </>
            )}
          </div>
          <div className="mono mt-0.5 text-[11px] text-faint">{step.venue}</div>
        </div>
        {apy && (
          <span className={`mono flex-none text-[12.5px] ${apy.negative ? "text-amber" : "text-green"}`}>{apy.text}</span>
        )}
      </div>
    </div>
  );
}

function PromptTab({ strategy }: { strategy: StrategyDetailType }) {
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-5" style={{ animation: "ffadein .25s ease both" }}>
      <div className="mb-2 text-[12px] font-medium text-muted">Strategy prompt</div>
      <p className="text-[14px] leading-relaxed text-fg-soft">
        {strategy.description || "No prompt recorded for this strategy."}
      </p>
      {strategy.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {strategy.tags.map((t) => (
            <span key={t} className="rounded-md bg-line px-2 py-0.5 text-[11px] font-medium text-fg-soft">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivityTab({ events, chainId = 143 }: { events: StrategyDetailType["history"]; chainId?: number }) {
  const sorted = [...events].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return (
    <div className="rounded-2xl border border-line-soft bg-surface p-5" style={{ animation: "ffadein .25s ease both" }}>
      {sorted.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-faint">No activity yet.</div>
      ) : (
        <div className="flex flex-col">
          {sorted.map((e, i) => (
            <div key={i} className="relative flex gap-3 pb-5 last:pb-0">
              {i !== sorted.length - 1 && <span className="absolute left-[5px] top-3 h-full w-px bg-line" aria-hidden />}
              <span className="relative z-10 mt-1 h-2.5 w-2.5 flex-none rounded-full border-2 border-surface bg-green/70" />
              <div className="min-w-0">
                <div className="text-[13px] text-fg-soft">{e.event}</div>
                <div className="mono mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                  <span>{new Date(e.at).toLocaleString()}</span>
                  {e.txHash && (
                    <a href={getExplorerUrl(chainId, e.txHash)} target="_blank" rel="noreferrer" className="text-muted transition-colors hover:text-green-bright">
                      {shortHash(e.txHash)} ↗
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- misc ---------------- */

function VerifiedBadge() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-green-bright" fill="currentColor" aria-label="Verified">
      <path d="M12 2l2.4 1.8 3 .2.2 3L19.4 9.6 21 12l-1.6 2.4.2 3-3 .2L14.4 19.4 12 21l-2.4-1.6-3 .2-.2-3L3.6 14.4 2 12l1.8-2.4-.2-3 3-.2L7.6 3.8 12 2z" />
      <path d="M10.5 14.6 8 12l-1.2 1.2 3.7 3.6L17 9.3 15.8 8z" fill="var(--color-base)" />
    </svg>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse" style={{ animation: "ffadein .3s ease both" }}>
      <div className="mb-6 h-9 w-72 rounded-lg bg-surface" />
      <div className="grid items-start gap-5 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-4">
          <div className="h-52 rounded-2xl bg-surface" />
          <div className="h-64 rounded-2xl bg-surface" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="h-11 rounded-xl bg-surface" />
          <div className="h-80 rounded-2xl bg-surface" />
        </div>
      </div>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="flex h-[300px] flex-col items-center justify-center rounded-2xl border border-line-soft bg-surface text-center">
      <div className="mb-2 text-[15px] font-semibold">Strategy not found</div>
      <div className="mb-5 text-[13px] text-muted">It may have been removed, or the link is wrong.</div>
      <Link href="/strategies" className="inline-flex h-9 items-center rounded-lg bg-fg px-4 text-[13px] font-semibold text-ink">
        Back to strategies
      </Link>
    </div>
  );
}
