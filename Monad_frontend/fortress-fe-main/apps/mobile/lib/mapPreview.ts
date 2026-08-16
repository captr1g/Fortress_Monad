import { formatUnits } from "viem";
import type { Preview } from "@fortress/core/types";

export type DisplayStep = {
  id: string;
  action: string;
  protocol?: string;
  token?: string; // single-token display (deposit-style)
  tokenIn?: string; // swap-style
  tokenOut?: string; // swap-style
  amount?: string; // formatted amount, for single-token steps
  apy?: number; // already a percentage (e.g. 2.76)
  apyKind?: "yield" | "cost";
  loop?: { position: "start" | "inside" | "end"; iterations: number };
};

function formatTokenAmount(amount: string, decimals = 18): string {
  try {
    const n = Number(formatUnits(BigInt(amount), decimals));
    if (!Number.isFinite(n)) return amount;
    if (n === 0) return "0";
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch {
    return amount;
  }
}

// deposit/swapAndDeposit intents have no ordered `steps` — just a flat
// allocation split across protocols. Ported from apps/web/lib/mapPreview.ts's
// allocationSteps(): synthesize a "Deposit" step + one "Supply X%" step per
// protocol leg, so both response shapes render through the same StepCard UI
// instead of leaving deposit-style plans with no step breakdown at all.
export function buildDisplaySteps(preview: Preview): DisplayStep[] {
  if (preview.steps && preview.steps.length > 0) {
    return detectLoops(
      preview.steps.map((s) => ({
        id: `${s.index}-${s.toolId}`,
        action: s.action,
        protocol: s.venue,
        tokenIn: s.tokenIn?.symbol,
        tokenOut: s.tokenOut?.symbol,
        token: !s.tokenOut ? s.tokenIn?.symbol : undefined,
        // API returns a fraction (0.004), not a percentage — matches
        // apps/web/lib/mapPreview.ts's `s.apy.value * 100` exactly.
        apy: s.apy ? s.apy.value * 100 : undefined,
        apyKind: s.apy?.kind,
      })),
    );
  }

  const alloc = preview.allocations;
  if (alloc) {
    const deposit: DisplayStep = {
      id: "deposit",
      action: "Deposit",
      token: alloc.token,
      amount: formatTokenAmount(alloc.amount, alloc.decimals ?? 18),
    };
    const legs: DisplayStep[] = alloc.legs.map((l) => {
      const pct = l.bps / 100;
      return {
        id: l.protocol,
        action: l.bps < 10000 ? `Supply ${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%` : "Supply",
        protocol: l.protocol,
        token: alloc.token,
        apy: l.apy !== null && l.apy !== undefined ? l.apy * 100 : undefined,
        apyKind: "yield",
      };
    });
    return [deposit, ...legs];
  }

  return [];
}

export type PreviewSummary = {
  chain: string;
  startingToken?: string;
  startingAmount?: string;
  /** Distinct tokens touched anywhere in the plan, in step order. */
  tokens: string[];
  netApy?: number; // already a percentage
  protocolsUsed: number;
  leverage?: number;
};

// Card/detail-screen summary for a saved strategy — mirrors web's
// strategySummary(), but derives straight from Preview since mobile has no
// Strategy adapter.
export function previewSummary(preview: Preview): PreviewSummary {
  const netApy = preview.apy?.netApy?.value ?? preview.netApy;
  const leverage = preview.apy?.leverage ?? preview.leverage;

  const tokens: string[] = [];
  const seen = new Set<string>();
  const addToken = (t?: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };

  let startingToken: string | undefined;
  let startingAmount: string | undefined;

  if (preview.steps && preview.steps.length > 0) {
    const first = preview.steps[0];
    startingToken = first.tokenIn?.symbol ?? first.tokenOut?.symbol;
    if (first.tokenIn?.amount) startingAmount = formatTokenAmount(first.tokenIn.amount, first.tokenIn.decimals ?? 18);
    for (const s of preview.steps) {
      addToken(s.tokenIn?.symbol);
      addToken(s.tokenOut?.symbol);
    }
  } else if (preview.allocations) {
    startingToken = preview.allocations.token;
    startingAmount = formatTokenAmount(preview.allocations.amount, preview.allocations.decimals ?? 18);
    addToken(preview.allocations.token);
  }

  const protocolsUsed = preview.steps
    ? new Set(preview.steps.map((s) => s.venue).filter(Boolean)).size
    : (preview.allocations?.legs.length ?? 0);

  return {
    chain: "Base", // v1 is Base-only
    startingToken,
    startingAmount,
    tokens,
    netApy: netApy !== undefined ? netApy * 100 : undefined,
    protocolsUsed: Math.max(protocolsUsed, tokens.length ? 1 : 0),
    leverage,
  };
}

// Identifies a step for repeat-detection purposes — same action/protocol/tokens
// means "the same cycle happened again" (e.g. a leverage loop's
// swap→swap→supply→borrow). Ported from apps/web/lib/mapPreview.ts.
function stepSignature(s: DisplayStep): string {
  return s.tokenIn && s.tokenOut
    ? `swap|${s.protocol ?? ""}|${s.tokenIn}|${s.tokenOut}`
    : `${s.action}|${s.protocol ?? ""}|${s.token ?? ""}`;
}

// Finds the longest contiguous block that repeats ≥2 times in a row and
// collapses the repeats into a single occurrence marked with
// loop.position/iterations, so StepCard renders it as one Loop card instead
// of N flat copies. Ported 1:1 from apps/web/lib/mapPreview.ts's
// detectLoops() — same algorithm, same tie-break (longest covered range).
function detectLoops(steps: DisplayStep[]): DisplayStep[] {
  const sigs = steps.map(stepSignature);
  const n = steps.length;
  let best: { start: number; length: number; iterations: number } | null = null;

  for (let start = 0; start < n; start++) {
    const maxLen = Math.min(Math.floor((n - start) / 2), 6);
    for (let length = 2; length <= maxLen; length++) {
      const block = sigs.slice(start, start + length).join(",");
      let iterations = 1;
      while (
        start + (iterations + 1) * length <= n &&
        sigs.slice(start + iterations * length, start + (iterations + 1) * length).join(",") === block
      ) {
        iterations++;
      }
      if (iterations >= 2) {
        const covered = length * iterations;
        if (!best || covered > best.length * best.iterations) {
          best = { start, length, iterations };
        }
      }
    }
  }

  if (!best) return steps;

  const { start, length, iterations } = best;
  const cycle = steps.slice(start, start + length).map((s, i) => ({
    ...s,
    loop:
      i === 0
        ? { position: "start" as const, iterations }
        : i === length - 1
          ? { position: "end" as const, iterations }
          : { position: "inside" as const, iterations },
  }));

  return [...steps.slice(0, start), ...cycle, ...steps.slice(start + length * iterations)];
}
