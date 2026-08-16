"use client";

import { useEffect, useRef, useState } from "react";

export type SimPhase = "idle" | "running" | "done";
export type StepState = "idle" | "pending" | "active" | "done";

const STEP_MS = 320; // dwell time per step in the execution wave

// Drives the "Simulate" execution wave: walks an active marker down the steps,
// then settles on done. Components read `stepStateAt(i)` to style each card.
export function useSimulation(stepCount: number) {
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);

  const total = STEP_MS * stepCount;

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function run() {
    if (timer.current) clearInterval(timer.current);
    startedAt.current = performance.now();
    setPhase("running");
    setElapsed(0);
    timer.current = setInterval(() => {
      const ms = performance.now() - startedAt.current;
      if (ms >= total) {
        if (timer.current) clearInterval(timer.current);
        setPhase("done");
        setElapsed(total);
      } else {
        setElapsed(ms);
      }
    }, 40);
  }

  const activeIndex = phase === "running" ? Math.floor(elapsed / STEP_MS) : -1;

  function stepStateAt(index: number): StepState {
    if (phase === "done") return "done";
    if (phase !== "running") return "idle";
    if (index < activeIndex) return "done";
    if (index === activeIndex) return "active";
    return "pending";
  }

  const label =
    phase === "running"
      ? "Simulating…"
      : phase === "done"
        ? "Re-run simulation"
        : "Simulate strategy";

  return { phase, run, stepStateAt, label, isComplete: phase === "done" };
}

export type Simulation = ReturnType<typeof useSimulation>;
