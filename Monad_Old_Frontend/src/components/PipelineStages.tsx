"use client";

import type { PhaseState } from "@/lib/types";

function StatusDot({ status }: { status: PhaseState["status"] }) {
  const base = "w-3 h-3 rounded-full";
  switch (status) {
    case "pending":
      return <div className={`${base} bg-zinc-600`} />;
    case "running":
      return <div className={`${base} bg-indigo-500 animate-pulse`} />;
    case "success":
      return <div className={`${base} bg-green-500`} />;
    case "error":
      return <div className={`${base} bg-red-500`} />;
  }
}

function PhaseBox({ state }: { state: PhaseState }) {
  const borderColor = {
    pending: "border-zinc-700",
    running: "border-indigo-500",
    success: "border-green-500/50",
    error: "border-red-500",
  }[state.status];

  const bgColor = {
    pending: "bg-[#12121a]",
    running: "bg-indigo-500/5",
    success: "bg-green-500/5",
    error: "bg-red-500/5",
  }[state.status];

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${borderColor} ${bgColor}`}>
      <StatusDot status={state.status} />
      <span className="text-sm font-medium text-zinc-300">{state.phase}</span>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" className="text-zinc-600 shrink-0">
      <path d="M0 6h16M12 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

export function PipelineStages({ phases }: { phases: PhaseState[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {phases.map((state, i) => (
        <div key={state.phase} className="flex items-center gap-2">
          <PhaseBox state={state} />
          {i < phases.length - 1 && <Arrow />}
        </div>
      ))}
    </div>
  );
}
