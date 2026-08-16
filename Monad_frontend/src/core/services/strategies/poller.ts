import type { StrategiesService } from "./strategies.service.js";

type PollerDeps = {
  service: StrategiesService;
  intervalMs: number;
};

type PollerState = {
  lastPollAt: string | null;
  runs: number;
  failures: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let state: PollerState = { lastPollAt: null, runs: 0, failures: 0 };

export function getStrategiesPollerState(): PollerState {
  return { ...state };
}

export function startStrategiesPoller(deps: PollerDeps): void {
  poll(deps);
  timer = setInterval(() => poll(deps), deps.intervalMs);
}

export function stopStrategiesPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// Recomputes net APY for all seeded strategies from fresh market rates. The structural
// build (leverage, market keys) is never recomputed here — only the rate-derived values.
async function poll(deps: PollerDeps): Promise<void> {
  try {
    await deps.service.refreshRates();
    state = {
      lastPollAt: new Date().toISOString(),
      runs: state.runs + 1,
      failures: state.failures,
    };
  } catch (err) {
    console.error("[strategies-poller] refresh failed:", err);
    state = {
      ...state,
      lastPollAt: new Date().toISOString(),
      failures: state.failures + 1,
    };
  }
}
