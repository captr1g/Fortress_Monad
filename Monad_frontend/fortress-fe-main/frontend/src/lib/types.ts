export type PhaseStatus = "pending" | "running" | "success" | "error";

export const PHASES = ["Understand", "Build", "Simulate"] as const;
export type Phase = (typeof PHASES)[number];

export type PhaseState = {
  phase: Phase;
  status: PhaseStatus;
};

export function initialPhases(): PhaseState[] {
  return PHASES.map((phase) => ({ phase, status: "pending" }));
}

export function runningPhases(activeIndex: number): PhaseState[] {
  return PHASES.map((phase, i) => ({
    phase,
    status: i < activeIndex ? "success" : i === activeIndex ? "running" : "pending",
  }));
}

export function successPhases(): PhaseState[] {
  return PHASES.map((phase) => ({ phase, status: "success" }));
}

export function errorPhases(failedIndex: number): PhaseState[] {
  return PHASES.map((phase, i) => ({
    phase,
    status: i < failedIndex ? "success" : i === failedIndex ? "error" : "pending",
  }));
}
