"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RegistryProtocol, RegistryMarket } from "@fortress/core";
import { ProtocolMark } from "@/components/strategy/icons";
import { buildTerminals } from "./terminals";

type TracePath = { key: string; owner: string; d: string };
type Pulse = { key: string; d: string; delay: number };

// The artifact's palette used white-alpha lines because the app's --color-line
// (#1f1f24) is invisible against these dark panels. StepCard set the precedent
// for white-alpha borders, so the board follows it.
const TRACE_IDLE = "rgba(255,255,255,0.10)";
const TRACE_BUS = "rgba(255,255,255,0.13)";

export function ProtocolBoard({
  protocols,
  markets,
  activeId,
  onSelect,
}: {
  protocols: RegistryProtocol[];
  markets: RegistryMarket[];
  activeId: string | null;
  onSelect: (name: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const padRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const termRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [paths, setPaths] = useState<TracePath[]>([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });
  // Boot: traces start undrawn, then draw in top-to-bottom once. `drawn`
  // flips to start the draw; `bootPhase` stays true until the stagger has
  // fully played out, then flips off so the dash normalization + per-path
  // delays stop interfering with the hover/select stroke transitions.
  const [drawn, setDrawn] = useState(false);
  const [bootPhase, setBootPhase] = useState(true);
  const bootStartedRef = useRef(false);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const prevActiveRef = useRef<string | null>(null);

  const reduceMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Recomputes every trace path from the current DOM layout. Runs after
  // paint, again when fonts land or anything resizes — a trace drawn from a
  // stale rect points at where a chip used to be, not where it is.
  const measure = useCallback(() => {
    const board = boardRef.current;
    if (!board) return;
    const boardRect = board.getBoundingClientRect();
    const rel = (r: DOMRect) => ({
      left: r.left - boardRect.left,
      right: r.right - boardRect.left,
      midY: r.top - boardRect.top + r.height / 2,
    });

    const pads = protocols
      .map((p) => padRefs.current.get(p.name))
      .filter((el): el is HTMLDivElement => !!el);
    if (!pads.length) return;
    const firstPad = rel(pads[0].getBoundingClientRect());
    const lastPad = rel(pads[pads.length - 1].getBoundingClientRect());
    const busX = firstPad.left + 4;

    const next: TracePath[] = [
      { key: "bus", owner: "", d: `M ${busX} ${firstPad.midY} V ${lastPad.midY}` },
    ];

    protocols.forEach((p) => {
      const pad = padRefs.current.get(p.name);
      const chip = chipRefs.current.get(p.name);
      if (!pad || !chip) return;
      const padR = rel(pad.getBoundingClientRect());
      const chipR = rel(chip.getBoundingClientRect());
      next.push({ key: `stub-${p.name}`, owner: p.name, d: `M ${busX} ${padR.midY} H ${chipR.left}` });

      buildTerminals(p, markets).forEach((_t, i) => {
        const term = termRefs.current.get(`${p.name}:${i}`);
        if (!term) return;
        const termR = rel(term.getBoundingClientRect());
        const midX = chipR.right + (termR.left - chipR.right) / 2;
        next.push({
          key: `${p.name}-${i}`,
          owner: p.name,
          d: `M ${chipR.right} ${chipR.midY} H ${midX} V ${termR.midY} H ${termR.left}`,
        });
      });
    });

    setSvgSize({ w: boardRect.width, h: boardRect.height });
    setPaths(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [protocols, markets]);

  useLayoutEffect(() => {
    measure();
    // Fonts shifting text metrics after first paint was exactly the bug that
    // left the bus line ending mid-board — remeasure when they settle, and on
    // any real size change of the grid itself.
    let fontsCancelled = false;
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.ready.then(() => {
        if (!fontsCancelled) measure();
      });
    }
    const ro = new ResizeObserver(() => measure());
    if (boardRef.current) ro.observe(boardRef.current);
    window.addEventListener("resize", measure);
    return () => {
      fontsCancelled = true;
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Kick the one-time boot draw after the first real measurement. Keyed on
  // "do we have paths at all", not the paths array itself — re-measures swap
  // the array identity, and letting that re-run this effect would cancel the
  // boot-completion timer via cleanup while the started-guard blocks ever
  // scheduling a new one, leaving bootPhase stuck on forever.
  const hasPaths = paths.length > 0;
  useEffect(() => {
    if (bootStartedRef.current || !hasPaths) return;
    bootStartedRef.current = true;
    if (reduceMotion) {
      setDrawn(true);
      setBootPhase(false);
      return;
    }
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)));
    // Longest path delay (~120 + n*30) + the 620ms draw, with headroom.
    const done = setTimeout(() => setBootPhase(false), 1900);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPaths]);

  // A dot travels every wire that just lit up, once, then removes itself.
  // Fires only on a genuinely new selection, not on deselect or re-measure.
  // The removal timer is deliberately NOT returned as cleanup: this effect
  // re-runs whenever a re-measure swaps the paths array, and cleanup would
  // cancel the removal, stranding spent dots (the pulse keyframe ends at
  // opacity 0.15, so a stranded dot stays faintly visible at the wire end).
  useEffect(() => {
    if (reduceMotion) return;
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeId;
    if (!activeId || activeId === prev) return;
    const owned = paths.filter((p) => p.owner === activeId);
    const fresh = owned.map((p, i) => ({ key: `${p.key}-${Date.now()}`, d: p.d, delay: i * 70 }));
    setPulses((cur) => [...cur, ...fresh]);
    setTimeout(
      () => setPulses((cur) => cur.filter((x) => !fresh.some((f) => f.key === x.key))),
      1400,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, paths]);

  let rowCursor = 1;
  const rows = protocols.map((p, protocolIndex) => {
    const terminals = buildTerminals(p, markets);
    const rowStart = rowCursor;
    const rowEnd = rowCursor + terminals.length - 1;
    rowCursor = rowEnd + 1;
    return { protocol: p, terminals, rowStart, rowEnd, protocolIndex };
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-surface py-7 pr-7 pl-2">
      <div
        ref={boardRef}
        className="relative grid min-w-[640px] grid-cols-[40px_1fr_1fr] gap-x-7 gap-y-2.5"
      >

        <svg
          className="pointer-events-none absolute inset-0"
          style={{ overflow: "visible" }}
          width={svgSize.w}
          height={svgSize.h}
        >
          {paths.map((p, i) => {
            const isBus = p.key === "bus";
            const isLive = p.owner !== "" && p.owner === activeId;
            const bootDelay = 120 + i * 30;
            return (
              <path
                key={p.key}
                d={p.d}
                fill="none"
                stroke={isLive ? "var(--color-gold)" : isBus ? TRACE_BUS : TRACE_IDLE}
                strokeWidth={isLive || isBus ? 2 : 1.5}
                pathLength={bootPhase ? 1 : undefined}
                style={{
                  transition: bootPhase
                    ? "stroke-dashoffset 620ms cubic-bezier(.3,.7,.2,1)"
                    : "stroke .35s ease, stroke-width .35s ease",
                  transitionDelay: bootPhase ? `${bootDelay}ms` : undefined,
                  strokeDasharray: isLive && !bootPhase ? "5 4" : bootPhase ? 1 : undefined,
                  strokeDashoffset: bootPhase ? (drawn ? 0 : 1) : undefined,
                  animation:
                    isLive && !bootPhase && !reduceMotion
                      ? "fboard-flow 900ms linear infinite"
                      : undefined,
                }}
              />
            );
          })}
        </svg>

        {pulses.map((pulse) => (
          <div
            key={pulse.key}
            className="pointer-events-none absolute top-0 left-0 z-10 h-1.5 w-1.5 rounded-full"
            style={{
              marginTop: -3,
              marginLeft: -3,
              background: "var(--color-gold)",
              boxShadow: "0 0 7px 1px rgba(250,204,21,0.65)",
              offsetPath: `path("${pulse.d}")`,
              offsetDistance: "0%",
              animation: "fboard-pulse 620ms cubic-bezier(.3,.7,.2,1) forwards",
              animationDelay: `${pulse.delay}ms`,
            }}
          />
        ))}

        {rows.map(({ protocol: p, terminals, rowStart, rowEnd, protocolIndex }) => {
          const isActive = activeId === p.name;
          const rowSpan = `${rowStart} / ${rowEnd + 1}`;
          const stagger = reduceMotion ? 0 : protocolIndex * 55;
          // Opacity-only entrance: a translateY entrance shifts the rects the
          // trace measurement reads, so the wires would be drawn against
          // mid-animation positions.
          const rise = reduceMotion
            ? undefined
            : `fboard-fade 480ms cubic-bezier(.2,.8,.2,1) both ${stagger}ms`;
          return (
            <div key={p.name} className="contents">
              <div
                ref={(el) => {
                  if (el) padRefs.current.set(p.name, el);
                }}
                className="relative col-start-1 h-2 w-2 justify-self-center self-center rounded-full bg-white/15"
                style={{ gridRow: rowSpan, animation: rise }}
              />

              <button
                ref={(el) => {
                  if (el) chipRefs.current.set(p.name, el);
                }}
                type="button"
                onClick={() => onSelect(p.name)}
                aria-pressed={isActive}
                style={{ gridRow: rowSpan, animation: rise }}
                className={`col-start-2 flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-gold/25 hover:shadow-[0_6px_16px_-8px_rgba(0,0,0,0.55)] ${
                  isActive
                    ? "border-gold bg-gold/10 shadow-[0_0_0_1px_rgba(250,204,21,0.12)]"
                    : "border-white/10 bg-elevated"
                }`}
              >
                <ProtocolMark name={p.name} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-fg">{p.name}</div>
                  <div
                    className={`mono text-[10px] font-semibold uppercase tracking-[0.08em] ${
                      p.kind === "fixed" ? "text-gold" : "text-faint"
                    }`}
                  >
                    {p.kind === "fixed" ? "Fixed yield" : p.kind === "routing" ? "Routing utility" : "Variable yield"}
                  </div>
                </div>
              </button>

              {terminals.map((t, i) => (
                <button
                  key={t.label}
                  ref={(el) => {
                    if (el) termRefs.current.set(`${p.name}:${i}`, el);
                  }}
                  type="button"
                  onClick={() => onSelect(p.name)}
                  style={{
                    gridRow: String(rowStart + i),
                    animation: reduceMotion
                      ? undefined
                      : `fboard-fade 480ms cubic-bezier(.2,.8,.2,1) both ${stagger + 90 + i * 40}ms`,
                  }}
                  className={`col-start-3 flex min-h-[40px] w-full items-center justify-between gap-2 rounded-lg border border-dashed bg-surface px-3 py-2 text-left transition-all duration-200 hover:-translate-y-0.5 ${
                    isActive ? "border-solid border-gold" : "border-white/10 hover:border-gold/25"
                  } ${t.action === "Swap" ? "opacity-70" : ""}`}
                >
                  <span className={`mono text-[12.5px] font-medium ${isActive ? "text-gold" : "text-fg"}`}>
                    {t.label}
                  </span>
                  <span className="mono flex-none rounded border border-white/10 px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                    {t.action}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
