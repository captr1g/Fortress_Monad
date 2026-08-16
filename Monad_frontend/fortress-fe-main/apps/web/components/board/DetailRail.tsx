"use client";

import type { RegistryProtocol, RegistryMarket } from "@fortress/core";
import { buildTerminals, KIND_LABEL, PROTOCOL_COPY } from "./terminals";

export function DetailRail({
  chainName,
  chainId,
  protocolCount,
  activeProtocol,
  markets,
}: {
  chainName: string;
  chainId: number;
  protocolCount: number;
  activeProtocol: RegistryProtocol | null;
  markets: RegistryMarket[];
}) {
  return (
    <aside className="sticky top-5 min-h-[260px] rounded-xl border border-white/10 bg-surface p-5">
      {activeProtocol ? (
        <div key={activeProtocol.name} style={{ animation: "ffadein .18s ease both" }}>
          <div className="mono mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
            Selected component
          </div>
          <h2 className="mono mb-1 text-[19px] font-bold text-fg">{activeProtocol.name}</h2>
          <div className="mono mb-3.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gold">
            {activeProtocol.kind === "routing" ? "Routing utility, not a vault" : KIND_LABEL[activeProtocol.kind]}
          </div>
          <p className="mb-4 text-[13.5px] leading-relaxed text-muted">{PROTOCOL_COPY[activeProtocol.name]?.method}</p>
          <ul className="mb-4 flex flex-col gap-2">
            {buildTerminals(activeProtocol, markets).map((t) => (
              <li
                key={t.label}
                className="mono rounded-md border border-white/10 bg-elevated px-2.5 py-2 text-[12px] text-muted"
              >
                <b className="text-fg">{t.label}</b> {t.sub}
              </li>
            ))}
          </ul>
          {PROTOCOL_COPY[activeProtocol.name]?.note && (
            <p className="border-t border-white/10 pt-3 text-[12px] leading-relaxed text-faint">
              {PROTOCOL_COPY[activeProtocol.name]?.note}
            </p>
          )}
        </div>
      ) : (
        <div style={{ animation: "ffadein .18s ease both" }}>
          <div className="mono mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">
            Board overview
          </div>
          <h2 className="mono mb-1 text-[19px] font-bold text-fg">
            {chainName}, chainId {chainId}
          </h2>
          <div className="mono mb-3.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-gold">
            Live today
          </div>
          <p className="mb-4 text-[13.5px] leading-relaxed text-muted">
            {protocolCount} protocols wired. Click any component on the board to see exactly where it sends your
            money and how its rate gets read.
          </p>
          <p className="border-t border-white/10 pt-3 text-[12px] leading-relaxed text-faint">
            Every chain runs its own lineup, switch tabs above to see how it changes.
          </p>
        </div>
      )}
    </aside>
  );
}
