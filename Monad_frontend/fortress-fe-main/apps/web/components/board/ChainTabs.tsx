"use client";

const CHAINS = [
  { id: "monad", name: "Monad", live: true },
  { id: "base", name: "Base", live: true },
  { id: "bnb", name: "BNB Chain", live: false },
  { id: "sui", name: "Sui", live: false },
  { id: "solana", name: "Solana", live: false },
] as const;

// Base is the only chain wired up today, so it's shown as the selected state
// with nothing to switch away to. The rest are inert labels, not tabs, until
// they're actually live.
export function ChainTabs() {
  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {CHAINS.map((chain) =>
        chain.live ? (
          <span
            key={chain.id}
            className="mono rounded-md border border-white/10 bg-surface px-3.5 py-2 text-[12.5px] font-semibold text-fg"
          >
            {chain.name}
          </span>
        ) : (
          <span
            key={chain.id}
            className="mono flex cursor-not-allowed items-center gap-2 rounded-md border border-white/5 px-3.5 py-2 text-[12.5px] font-medium text-faint"
          >
            {chain.name}
            <span className="rounded border border-white/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.05em]">
              Coming soon
            </span>
          </span>
        ),
      )}
    </div>
  );
}
