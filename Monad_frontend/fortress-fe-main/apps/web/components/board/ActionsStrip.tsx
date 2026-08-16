"use client";

const ACTIONS = [
  { name: "Deposit", desc: "Split your deposit across protocols by percentage. One signature covers it." },
  { name: "Swap & Deposit", desc: "Start from ETH or another token. Fortress swaps to USDC first, then deposits." },
  { name: "Leverage Loop", desc: "Supply, borrow, and redeposit through Morpho, repeated to a target multiple." },
  { name: "Manual Exit", desc: "Close to USDC, repay and keep collateral, or deleverage to a target LTV, from Portfolio." },
  { name: "Rebalance", desc: "Move an existing position from one protocol to another without a full exit." },
];

export function ActionsStrip() {
  return (
    <div className="mt-10">
      <div className="mono mb-3.5 text-[13px] font-semibold uppercase tracking-[0.1em] text-muted">
        What rides these wires
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {ACTIONS.map((a) => (
          <div
            key={a.name}
            className="rounded-lg border border-white/10 bg-surface p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/25 hover:shadow-[0_8px_18px_-10px_rgba(0,0,0,0.5)]"
          >
            <div className="mono mb-1.5 text-[12.5px] font-bold text-gold">{a.name}</div>
            <div className="text-[12px] leading-relaxed text-muted">{a.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
