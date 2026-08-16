"use client";

import type { LeverageDetail, StrategyStep } from "@/lib/strategy";
import { cn } from "@/lib/cn";
import type { Simulation } from "./useSimulation";
import { ProtocolMark, TokenChip, VaultBadge } from "./icons";
import type { Strategy } from "@/lib/strategy";

/* ── group loop steps into one block — each step otherwise renders as its
   own card, one per real step. ── */
type StepItem = { step: StrategyStep; index: number };
type StepGroup =
  | { type: "step"; step: StrategyStep; index: number }
  | { type: "loop"; steps: StepItem[]; iterations: number };

function groupSteps(steps: StrategyStep[]): StepGroup[] {
  const out: StepGroup[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (s.loop?.position === "start") {
      const items: StepItem[] = [{ step: s, index: i }];
      i++;
      while (i < steps.length && steps[i].loop?.position !== "end") {
        items.push({ step: steps[i], index: i });
        i++;
      }
      if (i < steps.length) { items.push({ step: steps[i], index: i }); i++; }
      out.push({ type: "loop", steps: items, iterations: s.loop.iterations ?? 2 });
    } else {
      out.push({ type: "step", step: s, index: i });
      i++;
    }
  }
  return out;
}

// How many rows StepList actually renders for this strategy — loop grouping
// means this can be less than strategy.steps.length, so anything displaying
// a step/action count (MetricRow, StepsPanel's header) should use this
// instead, or it'll show a number that doesn't match what's on screen.
export function countVisualSteps(steps: StrategyStep[]): number {
  return groupSteps(steps).reduce((n, g) => n + (g.type === "loop" ? g.steps.length : 1), 0);
}

/* ── StepList — assigns display numbers as a running count of rendered
   rows, not raw array indices, so a loop block doesn't leave gaps. ── */
export function StepList({ strategy, sim }: { strategy: Strategy; sim: Simulation }) {
  const groups = groupSteps(strategy.steps);
  const elements = [];
  let n = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (g.type === "step") {
      n++;
      elements.push(
        <div key={gi}>
          {gi > 0 && <Chevron />}
          <RegularStep step={g.step} index={g.index} n={n} sim={sim} />
        </div>
      );
    } else {
      const startN = n + 1;
      n += g.steps.length;
      elements.push(
        <div key={gi}>
          {gi > 0 && <Chevron />}
          <LoopCard group={g} startN={startN} sim={sim} />
        </div>
      );
    }
  }

  return (
    <div className="mx-auto flex max-w-[420px] flex-col">
      {elements}
    </div>
  );
}

/* ── RegularStep ──
   ┌──────────────────────────────────┐
   │ 1  ┌─────────────────────────┐  │
   │    │ Starting Token    2.50  │  │
   │    │ ───────────────────────  │  │
   │    │ —                 ETH   │  │
   │    └─────────────────────────┘  │
   └──────────────────────────────────┘ */
function RegularStep({ step, index, n, sim }: { step: StrategyStep; index: number; n: number; sim: Simulation }) {
  const state = sim.stepStateAt(index);
  const active = state === "active";
  const done = state === "done";
  return (
    <div className={cn(
      "flex rounded-xl bg-[#161619] transition-all duration-400",
      active && "bg-[#1b1b1f] shadow-[0_2px_12px_-4px_rgba(0,0,0,.5)]",
      !active && !done && "opacity-40",
    )}>
      <Num n={n} active={active} done={done} />
      <div className="my-[6px] mr-[6px] flex-1 rounded-lg bg-[#0e0e11]">
        <StepInner step={step} active={active} />
      </div>
    </div>
  );
}

/* ── LoopCard ──
   One big card wrapping the loop header, inner steps, and END footer.
   Inner step cards have NO border — just bg difference. */
function LoopCard({ group, startN, sim }: { group: Extract<StepGroup, { type: "loop" }>; startN: number; sim: Simulation }) {
  const anyActive = group.steps.some(s => sim.stepStateAt(s.index) === "active");
  const allDone   = group.steps.every(s => sim.stepStateAt(s.index) === "done");
  const dim       = !anyActive && !allDone;
  return (
    <div className={cn(
      "rounded-xl bg-[#161619] transition-all duration-400",
      anyActive && "bg-[#1b1b1f] shadow-[0_2px_12px_-4px_rgba(0,0,0,.5)]",
      dim && "opacity-40",
    )}>
      {/* LOOP header */}
      <div className="flex items-center gap-2.5 px-3.5 pt-3.5 pb-2.5">
        <div className="flex h-[27px] w-[27px] items-center justify-center rounded-full border border-white/20">
          <span className="font-mono text-[10.5px] font-bold leading-none text-white/65">{group.iterations}x</span>
        </div>
        <span className="text-[10.5px] font-bold uppercase tracking-[.16em] text-white/35">Loop</span>
        <div className="h-px flex-1 bg-white/[.07]" />
      </div>

      {/* Inner steps */}
      <div className="flex flex-col px-[6px] pb-[6px]">
        {group.steps.map(({ step, index }, si) => {
          const state  = sim.stepStateAt(index);
          const active = state === "active";
          const done   = state === "done";
          return (
            <div key={step.id}>
              {si > 0 && <Chevron inner />}
              <div className="flex rounded-lg bg-[#111114]">
                <Num n={startN + si} active={active} done={done} small />
                <div className="my-[5px] mr-[5px] flex-1 rounded-md bg-[#0c0c0f]">
                  <StepInner step={step} active={active} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* END footer */}
      <div className="flex items-center gap-2 px-3 pt-1 pb-3">
        <div className="h-px w-4 bg-white/[.07]" />
        <span className="text-[9.5px] font-bold uppercase tracking-[.16em] text-white/30">End</span>
        <div className="h-px flex-1 bg-white/[.07]" />
      </div>
    </div>
  );
}

/* ── StepInner — the dark inset content (shared) ── */
function StepInner({ step, active }: { step: StrategyStep; active: boolean }) {
  return (
    <>
      {/* Row 1 */}
      <div className="flex items-baseline justify-between px-3 pt-2.5 pb-2">
        <span className={cn("text-[13.5px] font-semibold leading-none tracking-tight", active ? "text-white/90" : "text-white/65")}>
          {step.action}
        </span>
        {step.kind === "token" && step.apy !== undefined && (
          <span className={cn(
            "font-mono text-[11.5px] font-semibold leading-none",
            step.apyKind === "cost" ? "text-[#f87171]" : "text-white/50",
          )}>
            APY {step.apyKind === "cost" ? "−" : "+"}{Math.abs(step.apy).toFixed(2)}
          </span>
        )}
        {step.kind === "single" && step.amount && (
          <span className="font-mono text-[11.5px] font-semibold leading-none text-white/50">{step.amount}</span>
        )}
      </div>

      <div className="mx-3 h-px bg-white/[.05]" />

      {/* Row 2 */}
      <div className="flex items-center justify-between px-3 pt-2 pb-2.5">
        <div className="flex items-center gap-2">
          {step.protocol
            ? (
              <>
                <ProtocolMark name={step.protocol} size={16} />
                <span className="text-[11px] font-medium text-white/45">{step.protocol}</span>
                {step.market && <VaultBadge label={step.market} address={step.marketAddress} />}
              </>
            )
            : <span className="text-[10px] text-white/15">—</span>}
        </div>
        {step.kind === "swap" ? (
          <div className="flex items-center gap-2">
            <TokenChip symbol={step.from!} />
            <div className="flex h-4 w-4 items-center justify-center rounded border border-white/[.08] bg-white/[.03]">
              <svg className="h-2 w-2 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
            <TokenChip symbol={step.to!} />
          </div>
        ) : step.token ? <TokenChip symbol={step.token} /> : null}
      </div>

      {step.detail && <LeverageStrip detail={step.detail} active={active} />}
    </>
  );
}

/* ── Num — step number inside card ── */
function Num({ n, active, done, small }: { n: number; active: boolean; done: boolean; small?: boolean }) {
  return (
    <div className={cn("flex flex-none items-start justify-center pt-2.5", small ? "w-8" : "w-9")}>
      <span className={cn(
        "font-mono font-bold tabular-nums leading-none",
        small ? "text-[14px]" : "text-[16px]",
        active ? "text-white/50" : done ? "text-white/22" : "text-white/10",
      )}>
        {n}
      </span>
    </div>
  );
}

/* ── Chevron ── */
function Chevron({ inner }: { inner?: boolean }) {
  return (
    <div className={cn("flex justify-center", inner ? "py-1" : "py-1.5")}>
      <svg className={cn("text-white/20", inner ? "h-2.5 w-2.5" : "h-3 w-3")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </div>
  );
}

/* ── LeverageStrip ── */
function LeverageStrip({ detail, active }: { detail: LeverageDetail; active: boolean }) {
  return (
    <div className="mx-3 mb-2 border-t border-white/[.03] pt-1.5">
      <div className="flex justify-between">
        <div className="flex gap-2.5">
          <Micro label="Collateral" value={detail.collateral} />
          <Micro label="Liq. price" value={detail.liqPrice} />
        </div>
        <Micro label="LTV" value={`${detail.ltv} / ${detail.liq}`} right />
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-white/[.04]">
        <div className="h-full w-[42%] rounded-full bg-white/15" />
      </div>
    </div>
  );
}

function Micro({ label, value, right }: { label: string; value: string; right?: boolean }) {
  return (
    <div className={right ? "text-right" : ""}>
      <div className="text-[7.5px] uppercase tracking-widest text-white/20">{label}</div>
      <div className="font-mono text-[9.5px] text-white/40">{value}</div>
    </div>
  );
}
