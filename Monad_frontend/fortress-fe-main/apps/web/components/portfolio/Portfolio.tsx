"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useChainId } from "wagmi";
import { motion } from "framer-motion";
import { TokenIcon, NetworkIcon, ProtocolMark } from "@/components/strategy/icons";
import { riseIn } from "@/lib/motion";
import { chainIdToNetwork } from "@/lib/chains";
import { useWalletAssets, type LiveAsset } from "./useWalletAssets";
import { useMorphoPositions, type MorphoPosition } from "./useMorphoPositions";
import { ExitModal } from "./ExitModal";
import { WithdrawModal, type WithdrawModalToken } from "./WithdrawModal";

// ─── helpers ─────────────────────────────────────────────────────────────────

function usd(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1_000) {
    return (n < 0 ? "-$" : "$") + (Math.abs(n) / 1_000).toFixed(1) + "k";
  }
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pct(n: number, signed = false) {
  return (signed && n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

// Risk colour is the ONE place we vary colour — green (safe) / amber / red.
function ltvFill(ratio: number) {
  if (ratio >= 0.9) return "var(--color-red)";
  if (ratio >= 0.7) return "var(--color-amber)";
  return "var(--color-green)";
}
function ltvText(ratio: number) {
  if (ratio >= 0.9) return "text-red";
  if (ratio >= 0.7) return "text-amber";
  return "text-green";
}
function hfColor(hf: number) {
  if (hf < 1.15) return "text-red";
  if (hf < 1.5) return "text-amber";
  return "text-fg-soft";
}

// ─── Portfolio content (embedded in /profile's Portfolio tab) ─────────────────
// The page shell (TopBar, header, auth gate) lives in ProfilePage — this
// component assumes an authenticated wallet and renders only the content.

export function PortfolioContent() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { assets: walletAssets, protocolAssets, totalUsd: walletAssetsUsd, isLoading, isPricePending, refetch: refetchAssets } = useWalletAssets();
  const {
    positions,
    isLoading: positionsLoading,
    isError: positionsError,
    stale,
    refetch: refetchPositions,
  } = useMorphoPositions();

  // Refresh BOTH data sources: Morpho positions (backend) and on-chain wallet
  // + protocol-token balances (wagmi). Wiring only one left the other stale
  // after a withdraw/exit/deploy until a manual refresh or tab focus.
  const refreshAll = useCallback(() => {
    refetchPositions();
    refetchAssets();
  }, [refetchPositions, refetchAssets]);

  // Morpho's GraphQL indexer (used for position discovery) lags the chain by a
  // few seconds after a tx confirms, so a single refresh right after opening a
  // brand-new position can miss it. When we land here from a fresh deploy
  // (?updated=1), re-poll a couple of times to catch the indexer up — no manual
  // refresh needed. Known positions (exit/withdraw/deleverage) are re-read
  // directly on-chain server-side and don't depend on this.
  const pollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    return () => pollTimers.current.forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("updated") !== "1") return;
    // Strip the flag so a later manual reload doesn't re-trigger the poll.
    params.delete("updated");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    refreshAll();
    pollTimers.current.push(setTimeout(refreshAll, 4000));
    pollTimers.current.push(setTimeout(refreshAll, 10000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vault-share tokens (Morpho, Aave, Fluid, Euler, ...) each get a row in the
  // "Protocol Tokens" card below, kept separate from the plain wallet list by
  // the hook itself — but it's still money the user holds, so Net worth
  // counts it either way.
  const protocolAssetsUsd = protocolAssets.reduce((s, a) => s + a.valueUsd, 0);
  const totalUsd = walletAssetsUsd + protocolAssetsUsd;

  const collateralTotal = positions.reduce((s, p) => s + p.collateralUsd, 0);
  const borrowTotal = positions.reduce((s, p) => s + p.borrowUsd, 0);
  const netWorth = totalUsd + collateralTotal - borrowTotal;

  const heroLoading = isLoading || isPricePending || positionsLoading;

  return (
    <div>
      <motion.div {...riseIn(0)}>
        <NetWorthHero
          netWorth={netWorth}
          walletUsd={totalUsd}
          collateralUsd={collateralTotal}
          borrowUsd={borrowTotal}
          loading={heroLoading}
        />
      </motion.div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1fr_400px]">
        {/* Left — Morpho positions */}
        <motion.section {...riseIn(1)}>
          <div className="mb-4 flex items-center gap-2.5">
            <ProtocolMark name="Morpho" size={18} />
            <h2 className="text-[14px] font-semibold">Morpho Positions</h2>
            {!positionsLoading && (
              <span className="mono rounded-full bg-line px-2 py-0.5 text-[11px] text-muted">{positions.length}</span>
            )}
            {stale && (
              <span className="ml-auto rounded-full border border-amber/25 bg-amber/10 px-2.5 py-0.5 text-[11px] text-amber">
                stale data
              </span>
            )}
            <button
              onClick={refreshAll}
              disabled={positionsLoading}
              className={`flex items-center gap-1.5 text-[12px] text-muted transition hover:text-fg-soft disabled:opacity-40 ${stale ? "" : "ml-auto"}`}
              title="Refresh positions"
            >
              <svg className={`h-3.5 w-3.5 ${positionsLoading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>

          {positionsError ? (
            <PositionsError onRetry={refreshAll} />
          ) : positionsLoading ? (
            <PositionsSkeleton />
          ) : positions.length === 0 ? (
            <PositionsEmpty />
          ) : (
            <div className="flex flex-col gap-4">
              {positions.map((pos, i) => (
                <motion.div key={pos.id} {...riseIn(2 + i)}>
                  <MorphoCard position={pos} walletAddress={address!} onExitSuccess={refreshAll} />
                </motion.div>
              ))}
            </div>
          )}
        </motion.section>

        {/* Right — Protocol tokens + Wallet assets */}
        <motion.div className="flex flex-col gap-5" {...riseIn(2)}>
          <ProtocolTokensSection assets={protocolAssets} isLoading={isLoading || isPricePending} walletAddress={address} onWithdrawSuccess={refreshAll} />
          <section>
            <div className="mb-4 flex items-center gap-2.5">
              <NetworkIcon network={chainIdToNetwork(chainId)} size={18} />
              <h2 className="text-[14px] font-semibold">Wallet Assets</h2>
              <span className="mono rounded-full bg-line px-2 py-0.5 text-[11px] text-muted">{isLoading ? 0 : walletAssets.length}</span>
            </div>
            <WalletAssetsPanel assets={walletAssets} totalUsd={walletAssetsUsd} isLoading={isLoading} isPricePending={isPricePending} network={chainIdToNetwork(chainId)} />
          </section>
        </motion.div>
      </div>
    </div>
  );
}

// ─── Net worth hero ────────────────────────────────────────────────────────────

function NetWorthHero({
  netWorth,
  walletUsd,
  collateralUsd,
  borrowUsd,
  loading,
}: {
  netWorth: number;
  walletUsd: number;
  collateralUsd: number;
  borrowUsd: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line/30 bg-surface-2/40 p-5 backdrop-blur-xl sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-6 sm:gap-x-10">
        <div>
          <div className="mb-2 text-[10.5px] font-medium uppercase tracking-widest text-faint">Net worth</div>
          {loading ? (
            <div className="h-10 w-48 animate-pulse rounded-md bg-line" />
          ) : (
            <div className="mono text-[32px] font-bold leading-none tracking-tight text-fg sm:text-[40px]">{usd(netWorth)}</div>
          )}
          <div className="mt-2.5 text-[11.5px] text-faint">wallet + supplied − borrowed</div>
        </div>

        <div className="flex divide-x divide-line-soft">
          <HeroStat label="Wallet" value={walletUsd} loading={loading} />
          <HeroStat label="Supplied" value={collateralUsd} loading={loading} />
          <HeroStat label="Borrowed" value={borrowUsd} loading={loading} negative />
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, loading, negative }: { label: string; value: number; loading: boolean; negative?: boolean }) {
  return (
    <div className="px-3 first:pl-0 last:pr-0 sm:px-6">
      <div className="mb-1.5 text-[11px] text-muted">{label}</div>
      {loading ? (
        <div className="h-5 w-20 animate-pulse rounded bg-line" />
      ) : (
        <div className={`mono text-[16px] font-semibold ${negative && value > 0 ? "text-amber" : "text-fg"}`}>
          {negative && value > 0 ? "-" : ""}
          {usd(value)}
        </div>
      )}
    </div>
  );
}

// ─── Wallet assets panel ──────────────────────────────────────────────────────

function WalletAssetsPanel({
  assets,
  totalUsd,
  isLoading,
  isPricePending,
  network,
}: {
  assets: LiveAsset[];
  totalUsd: number;
  isLoading: boolean;
  isPricePending: boolean;
  network?: string;
}) {
  const networkName = network === "monad" ? "Monad" : "Base";

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-line" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-20 rounded bg-line" />
              <div className="h-2.5 w-14 rounded bg-line" />
            </div>
            <div className="h-3 w-16 rounded bg-line" />
          </div>
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex h-[180px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-center">
        <div className="text-[13px] text-muted">No assets found on {networkName}</div>
        <div className="mt-1 text-[12px] text-faint">Bridge or deposit funds to get started</div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface">
      {assets.map((asset, i) => (
        <AssetRow key={asset.address} asset={asset} totalUsd={totalUsd} last={i === assets.length - 1} pricePending={isPricePending} />
      ))}
      <div className="flex items-center justify-between border-t border-line-soft bg-surface-2 px-4 py-3 text-[12.5px]">
        <span className="font-medium text-muted">Total</span>
        <span className="mono font-semibold text-fg">
          {isPricePending ? <span className="inline-block h-3.5 w-16 animate-pulse rounded bg-line" /> : usd(totalUsd)}
        </span>
      </div>
    </div>
  );
}

function AssetRow({
  asset,
  totalUsd,
  last,
  pricePending,
}: {
  asset: LiveAsset;
  totalUsd: number;
  last: boolean;
  pricePending: boolean;
}) {
  const share = totalUsd > 0 ? (asset.valueUsd / totalUsd) * 100 : 0;

  return (
    <div className={`grid grid-cols-[1fr_auto] items-center gap-x-4 px-4 py-3.5 text-[13px] transition-colors hover:bg-elevated ${last ? "" : "border-b border-line-soft"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <TokenIcon symbol={asset.symbol} size={30} />
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{asset.symbol}</div>
          <div className="mono text-[11px] text-faint">
            {asset.balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}
          </div>
        </div>
      </div>
      <div className="text-right">
        <div className="mono font-semibold text-fg">
          {pricePending ? <span className="inline-block h-3 w-14 animate-pulse rounded bg-line" /> : usd(asset.valueUsd, true)}
        </div>
        <div className="mono text-[11px] text-faint">{pricePending ? "—" : `${share.toFixed(1)}%`}</div>
      </div>
    </div>
  );
}

// ─── Morpho positions states ──────────────────────────────────────────────────

function PositionsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-line-soft bg-surface p-5 animate-pulse">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-line" />
              <div className="space-y-2">
                <div className="h-3.5 w-32 rounded bg-line" />
                <div className="h-2.5 w-20 rounded bg-line" />
              </div>
            </div>
            <div className="h-9 w-28 rounded-lg bg-line" />
          </div>
          <div className="mb-5 grid grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="rounded-xl border border-line-soft bg-surface-2 px-3 py-3 space-y-2">
                <div className="h-2.5 w-14 rounded bg-line" />
                <div className="h-4 w-16 rounded bg-line" />
              </div>
            ))}
          </div>
          <div className="h-2 rounded-full bg-line" />
        </div>
      ))}
    </div>
  );
}

function PositionsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-red/25 bg-red/5 text-center">
      <div className="mb-1.5 text-[14px] font-semibold text-red">Failed to load positions</div>
      <p className="mb-4 text-[12.5px] text-muted">Could not reach the Fortress API.</p>
      <button onClick={onRetry} className="h-9 rounded-lg border border-line px-4 text-[13px] font-medium text-muted hover:text-fg hover:bg-elevated transition">
        Try again
      </button>
    </div>
  );
}

function PositionsEmpty() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-center">
      <div className="mb-1 text-[13px] text-muted">No Morpho positions found</div>
      <div className="text-[12px] text-faint">Deploy a strategy to open your first position.</div>
    </div>
  );
}

// ─── Morpho position card ─────────────────────────────────────────────────────

function MorphoCard({
  position: pos,
  walletAddress,
  onExitSuccess,
}: {
  position: MorphoPosition;
  walletAddress: string;
  onExitSuccess: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  const ltvRatio = pos.maxLtv > 0 ? pos.ltv / pos.maxLtv : 0;
  const equity = pos.collateralUsd - pos.borrowUsd;
  const buffer = Math.max(0, (pos.maxLtv - pos.ltv) * 100);

  return (
    <>
      {modalOpen && (
        <ExitModal position={pos} walletAddress={walletAddress} onClose={() => setModalOpen(false)} onSuccess={onExitSuccess} />
      )}

      <div className="rounded-2xl border border-line-soft bg-surface p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-line sm:p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="relative">
              <TokenIcon symbol={pos.collateralSymbol} size={34} />
              <span className="absolute -bottom-1 -right-1">
                <TokenIcon symbol={pos.borrowSymbol} size={18} />
              </span>
            </div>
            <div>
              <div className="text-[15px] font-medium text-fg">{pos.market}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                <NetworkIcon network={pos.network} size={12} />
                {pos.networkLabel}
                <span className="text-faint">·</span>
                <ProtocolMark name="Morpho" size={12} />
                Morpho
              </div>
            </div>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-[12px] font-medium text-muted transition-colors hover:border-red/20 hover:bg-red/10 hover:text-red"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Exit Position
          </button>
        </div>

        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PositionMetric label="Collateral" value={usd(pos.collateralUsd, true)} sub={pos.collateralSymbol} />
          <PositionMetric label="Borrowed" value={usd(pos.borrowUsd, true)} sub={pos.borrowSymbol} valueClass="text-amber" />
          <PositionMetric label="Equity" value={usd(equity, true)} sub="net value" valueClass="text-green-bright" />
          <PositionMetric label="Net APY" value={pct(pos.netApy, true)} sub="&nbsp;" valueClass="text-green-bright" />
        </div>

        <LtvBar ltv={pos.ltv} maxLtv={pos.maxLtv} ratio={ltvRatio} />

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line-soft pt-4 text-[12.5px]">
          <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
            <span className="text-muted">Health factor</span>
            <span className={`mono font-semibold ${hfColor(pos.healthFactor)}`}>
              {pos.healthFactor >= 99 ? "∞" : pos.healthFactor.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
            <span className="text-muted">Buffer to liquidation</span>
            <span className={`mono font-medium ${buffer < 10 ? "text-amber" : "text-fg"}`}>{buffer.toFixed(1)} pts</span>
          </div>
        </div>
      </div>
    </>
  );
}

function LtvBar({ ltv, maxLtv, ratio }: { ltv: number; maxLtv: number; ratio: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
        <span className="text-muted">Loan-to-Value</span>
        <div className="flex items-center gap-2">
          <span className={`mono font-semibold ${ltvText(ratio)}`}>{pct(ltv * 100)}</span>
          <span className="text-faint">/ max {pct(maxLtv * 100)}</span>
        </div>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(ratio * 100, 100)}%`, background: ltvFill(ratio) }}
        />
      </div>
      <div className="mt-1 flex justify-end text-[10.5px] text-faint">Liquidation at {pct(maxLtv * 100)}</div>
    </div>
  );
}

// ─── Protocol tokens section ─────────────────────────────────────────────────

function ProtocolTokensSection({
  assets,
  isLoading,
  walletAddress,
  onWithdrawSuccess,
}: {
  assets: LiveAsset[];
  isLoading: boolean;
  walletAddress?: string;
  onWithdrawSuccess: () => void;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-[14px] font-semibold">Protocol Tokens</h2>
        {!isLoading && (
          <span className="mono rounded-full bg-line px-2 py-0.5 text-[11px] text-muted">{assets.length}</span>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface divide-y divide-line-soft">
        {isLoading ? (
          <ProtocolTokenRow asset={undefined} isLoading walletAddress={walletAddress} onWithdrawSuccess={onWithdrawSuccess} />
        ) : assets.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12.5px] text-faint">No protocol positions yet.</p>
        ) : (
          assets.map((asset) => (
            <ProtocolTokenRow
              key={asset.address}
              asset={asset}
              isLoading={false}
              walletAddress={walletAddress}
              onWithdrawSuccess={onWithdrawSuccess}
            />
          ))
        )}
      </div>
    </section>
  );
}

function ProtocolTokenRow({
  asset,
  isLoading,
  walletAddress,
  onWithdrawSuccess,
}: {
  asset: LiveAsset | undefined;
  isLoading: boolean;
  walletAddress?: string;
  onWithdrawSuccess: () => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const balance = asset?.balance ?? 0;
  const valueUsd = asset?.valueUsd ?? 0;

  const modalToken: WithdrawModalToken | undefined = asset && {
    symbol: asset.symbol,
    name: asset.name,
    address: asset.address,
    decimals: asset.decimals,
    balance,
  };

  return (
    <>
      {modalOpen && walletAddress && modalToken && (
        <WithdrawModal
          token={modalToken}
          walletAddress={walletAddress}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            setModalOpen(false);
            onWithdrawSuccess();
          }}
        />
      )}

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 px-4 py-3.5 text-[13px] transition-colors hover:bg-elevated">
        {/* Left — icon + name + balance (mirrors AssetRow below) */}
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon symbol={asset?.symbol ?? ""} size={30} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-fg">{asset?.symbol}</span>
              {asset?.protocolName && (
                <span className="rounded-full bg-line px-1.5 py-px text-[10px] font-medium text-muted">via {asset.protocolName}</span>
              )}
            </div>
            {isLoading ? (
              <div className="mt-1 h-2.5 w-14 animate-pulse rounded bg-line" />
            ) : (
              <div className="mono mt-0.5 text-[11px] text-faint">
                {balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })}
              </div>
            )}
          </div>
        </div>

        {/* Value */}
        <div className="text-right">
          {isLoading ? (
            <div className="inline-block h-3 w-14 animate-pulse rounded bg-line" />
          ) : (
            <div className="mono font-semibold text-fg">{usd(valueUsd, true)}</div>
          )}
        </div>

        <button
          onClick={() => setModalOpen(true)}
          disabled={!walletAddress || isLoading || balance === 0}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-[12px] font-medium text-muted transition-colors hover:border-line hover:bg-elevated hover:text-fg-soft disabled:pointer-events-none disabled:opacity-30"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Withdraw
        </button>
      </div>
    </>
  );
}

// ─── Position metric ──────────────────────────────────────────────────────────

function PositionMetric({ label, value, sub, valueClass }: { label: string; value: string; sub: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface-2 px-3 py-3">
      <div className="mb-1 text-[10.5px] text-muted">{label}</div>
      <div className={`mono text-[16px] font-semibold ${valueClass ?? "text-fg"}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-faint" dangerouslySetInnerHTML={{ __html: sub }} />
    </div>
  );
}
