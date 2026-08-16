"use client";

import { useState } from "react";
import { useRegistry, useSeedRegistryCache } from "@fortress/core/hooks";
import { TopBar } from "@/components/strategy/TopBar";
import { ChainTabs } from "./ChainTabs";
import { ProtocolBoard } from "./ProtocolBoard";
import { DetailRail } from "./DetailRail";
import { buildTerminals } from "./terminals";
import { ActionsStrip } from "./ActionsStrip";

const BASE_CHAIN_ID = 8453;

export function BoardPage() {
  useSeedRegistryCache();
  const { data, isLoading, isError } = useRegistry();
  const [activeName, setActiveName] = useState<string | null>(null);

  const chain = data?.chains.find((c) => c.chainId === BASE_CHAIN_ID);
  const protocols = chain?.protocols ?? [];
  const markets = chain?.markets ?? [];
  const destinationCount = protocols.reduce((sum, p) => sum + buildTerminals(p, markets).length, 0);
  const activeProtocol = protocols.find((p) => p.name === activeName) ?? null;
  // Distinct from a real "nothing here" state: the registry loaded fine but
  // doesn't have protocol data yet (a stale deploy), so say that plainly
  // instead of quietly showing "0 protocols" as if it were normal.
  const protocolsUnavailable = !isLoading && !isError && !!chain && !chain.protocols;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{
        // The artifact's graph-paper texture + faint gold glow, on the app's
        // own base color. This page-level atmosphere is most of what made the
        // approved design read as "a board" instead of a plain list page.
        background: [
          "radial-gradient(ellipse 900px 500px at 12% -8%, rgba(250,204,21,0.05), transparent 60%)",
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 28px)",
          "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 1px, transparent 1px, transparent 28px)",
          "var(--color-base)",
        ].join(", "),
      }}
    >
      <TopBar />
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 py-10 sm:px-6">
        <div style={{ animation: "ffadein .4s ease both" }}>
          <div className="mono mb-3 flex items-center gap-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            <span className="inline-block h-[7px] w-[7px] rounded-[1px] bg-gold" aria-hidden />
            Base mainnet, chainId {BASE_CHAIN_ID}
          </div>
          <h1 className="mono mb-3 text-[28px] font-bold tracking-tight text-fg sm:text-[34px]">
            The Fortress board
          </h1>
          <p className="mb-6 max-w-[62ch] text-[15px] leading-relaxed text-muted">
            Every wire your deposit can travel, laid out like the schematic it actually is. Click a component to
            trace exactly <b className="font-semibold text-fg">which contract holds your funds</b> and how its
            rate gets read. Different chains run different wiring, switch below to see it change.
          </p>
        </div>

        <ChainTabs />

        {isLoading && <BoardSkeleton />}
        {isError && (
          <div className="rounded-xl border border-line-soft bg-surface-2 p-4 text-[13px] text-muted">
            Couldn&apos;t load the protocol list. Try refreshing.
          </div>
        )}
        {protocolsUnavailable && (
          <div className="rounded-xl border border-line-soft bg-surface-2 p-4 text-[13px] text-muted">
            Protocol details aren&apos;t available from the backend yet. Try again shortly.
          </div>
        )}
        {!isLoading && !isError && !protocolsUnavailable && chain && (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
            <ProtocolBoard
              protocols={protocols}
              markets={markets}
              activeId={activeName}
              onSelect={(name) => setActiveName((cur) => (cur === name ? null : name))}
            />
            <DetailRail
              chainName={chain.label}
              chainId={chain.chainId}
              protocolCount={protocols.length}
              activeProtocol={activeProtocol}
              markets={markets}
            />
          </div>
        )}

        <ActionsStrip />

        <div className="mono mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-white/10 pt-4 text-[11px] text-faint">
          <span>
            <b className="font-bold text-gold">{protocols.length}</b> protocols,{" "}
            <b className="font-bold text-gold">{destinationCount}</b> destinations wired
          </span>
          <span>Sui and Solana are further out, no dates confirmed yet</span>
        </div>
      </main>
    </div>
  );
}

function BoardSkeleton() {
  return <div className="h-[420px] animate-pulse rounded-xl border border-line-soft bg-surface-2" />;
}
