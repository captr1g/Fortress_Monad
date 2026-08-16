import type { Preview, StrategyStep as ApiStrategyStep } from "@fortress/core";
import type { ApyLeg, LeverageDetail, Strategy, StrategyStep } from "./strategy";
import { formatTokenAmount } from "./format";

const CHAIN_LABEL: Record<number, string> = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum",
  10: "Optimism",
  137: "Polygon",
};

// Fallback resolution for known Base tokens — in case the backend omits
// `symbol`/`decimals` on a step's TokenAmount (which makes amounts render raw).
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", decimals: 6 },
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb": { symbol: "DAI", decimals: 18 },
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH", decimals: 18 },
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": { symbol: "wstETH", decimals: 18 },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", decimals: 8 },
};

type ApiToken = { symbol: string; address: string; decimals: number; amount: string };

function resolveToken(t?: ApiToken): { symbol: string; decimals: number } | undefined {
  if (!t) return undefined;
  const known = KNOWN_TOKENS[(t.address ?? "").toLowerCase()];
  const symbol =
    (t.symbol && t.symbol.trim()) ||
    known?.symbol ||
    (t.address ? `${t.address.slice(0, 6)}…${t.address.slice(-4)}` : "?");
  const decimals = t.decimals && t.decimals > 0 ? t.decimals : (known?.decimals ?? 18);
  return { symbol, decimals };
}

// Maps a backend Preview into the display Strategy the visualizer renders.
export function previewToStrategy(
  preview: Preview,
  opts: { prompt: string; name: string },
): Strategy {
  const apiSteps = preview.steps ?? [];
  const chainId = apiSteps[0]?.chainId ?? 8453;
  const protocols = new Set(apiSteps.map((s) => s.venue).filter(Boolean));
  const alloc = preview.allocations;
  const start =
    resolveToken(apiSteps[0]?.tokenIn) ??
    resolveToken(apiSteps[0]?.tokenOut) ??
    (alloc ? { symbol: alloc.token, decimals: alloc.decimals ?? 18 } : undefined);

  // Prefer the structured apy.netApy from the API response, then the flat
  // netApy field (also covers deposit-intent depositApy, folded in upstream),
  // then derive from step APY data as a last resort.
  const netApy =
    preview.apy?.netApy?.value ??
    preview.netApy ??
    deriveNetApy(apiSteps);

  const chain = CHAIN_LABEL[chainId] ?? `Chain ${chainId}`;
  // The backend doesn't always return a name and the user may not have typed
  // one — fall back to something readable instead of an empty string (which
  // otherwise surfaces as "Untitled strategy" everywhere it's saved/shown).
  const name = preview.name || opts.name || `${start?.symbol ?? "New"} strategy on ${chain}`;

  return {
    name,
    chain,
    startingToken: start?.symbol ?? "ETH",
    prompt: opts.prompt,
    netApy: netApy * 100, // API returns decimal (0.004) → display as percent (0.40%)
    protocolsUsed: Math.max(protocols.size || (alloc?.legs.length ?? 0), 1),
    legs: buildLegsFromPreview(preview, apiSteps),
    steps: alloc ? allocationSteps(alloc) : detectLoops(apiSteps.map(mapStep)),
    allocations: alloc
      ? {
          token: alloc.token,
          // Raw smallest-units string (e.g. "2000000" for 2 USDC) — the only
          // consumer is strategySummary()'s display-only startingAmount, so
          // format it here rather than leaving callers to remember to.
          amount: formatTokenAmount(alloc.amount, alloc.decimals ?? 18),
          decimals: alloc.decimals ?? 18,
          legs: alloc.legs.map((l) => ({ protocol: l.protocol, bps: l.bps, apy: l.apy ?? null, status: l.status, market: l.market, marketAddress: l.marketAddress })),
        }
      : undefined,
    leverage: deriveLeverage(preview, netApy),
  };
}

// Prefer the backend's own leverage figure. Some responses include
// collateralApy/borrowApy without it — in that case solve netApy's own
// formula (netApy = L·(c−b) + b) for L instead of just hiding the leverage
// info entirely.
function deriveLeverage(preview: Preview, netApy: number): number | undefined {
  const explicit = preview.apy?.leverage;
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;

  const c = preview.apy?.collateralApy?.value;
  const b = preview.apy?.borrowApy?.value;
  if (typeof c !== "number" || typeof b !== "number" || c === b) return undefined;

  const derived = (netApy - b) / (c - b);
  return Number.isFinite(derived) && derived > 1 ? derived : undefined;
}

// deposit/swapAndDeposit intents have no ordered steps — represent the
// deposit and each protocol allocation as synthetic StrategyStep entries so
// they render through the exact same step-card UI as everything else,
// instead of a bespoke panel.
function allocationSteps(alloc: NonNullable<Preview["allocations"]>): StrategyStep[] {
  const deposit: StrategyStep = {
    id: "deposit",
    action: "Deposit",
    kind: "single",
    token: alloc.token,
    amount: formatTokenAmount(alloc.amount, alloc.decimals ?? 18),
  };

  const legs: StrategyStep[] = alloc.legs.map((l) => {
    const pct = l.bps / 100;
    return {
      id: l.protocol,
      action: l.bps < 10000 ? `Supply ${pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(2)}%` : "Supply",
      kind: "token",
      protocol: l.protocol,
      market: l.market,
      marketAddress: l.marketAddress,
      token: alloc.token,
      apy: l.apy !== null && l.apy !== undefined ? l.apy * 100 : undefined,
      apyKind: "yield",
    };
  });

  return [deposit, ...legs];
}

// Identifies a step for repeat-detection purposes — same action/protocol/tokens
// means "the same cycle happened again" (e.g. a leverage loop's swap→swap→supply→borrow).
function stepSignature(s: StrategyStep): string {
  return s.kind === "swap"
    ? `swap|${s.protocol ?? ""}|${s.from ?? ""}|${s.to ?? ""}`
    : `${s.action}|${s.kind}|${s.protocol ?? ""}|${s.token ?? ""}`;
}

// Finds the longest contiguous block that repeats ≥2 times in a row (e.g. a
// leverage loop) and collapses the repeats into a single occurrence marked
// with loop.position/iterations, so StepCard renders it as one Loop card
// instead of N flat copies. Steps before/after the block, including a
// trailing partial cycle, stay in their original order.
function detectLoops(steps: StrategyStep[]): StrategyStep[] {
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
          : { position: "inside" as const },
  }));

  return [...steps.slice(0, start), ...cycle, ...steps.slice(start + length * iterations)];
}

// Sum earn APYs minus cost APYs from step data when the top-level netApy is absent.
function deriveNetApy(steps: ApiStrategyStep[]): number {
  return steps.reduce((acc, s) => {
    if (!s.apy) return acc;
    return acc + (s.apy.kind === "cost" ? -s.apy.value : s.apy.value);
  }, 0);
}

// Pendle PT/YT/LP legs and a leverage-open are conceptually swaps too (input
// token → a different output token) — the swap-chip treatment (tokenIn →
// tokenOut with an arrow) reads clearer than a bare single-token badge for
// any of these, and matches mobile's field-presence-driven logic
// (apps/mobile/components/strategy/StepCard.tsx just checks tokenIn &&
// tokenOut, no action-name allowlist).
const SWAP_LIKE_ACTIONS = new Set(["Swap", "Bridge", "Swap to PT", "Swap to YT", "Add Liquidity", "Wrap LP", "Open Leverage"]);

function mapStep(s: ApiStrategyStep): StrategyStep {
  const id = `${s.index}-${s.toolId}`;
  const inTok = resolveToken(s.tokenIn);
  const outTok = resolveToken(s.tokenOut);

  // Normalise action to title-case for comparison — the legacy adapter already
  // uppercases it (Swap, Supply, Borrow…) but guard against raw lowercase too.
  const action = s.action;

  if (SWAP_LIKE_ACTIONS.has(action) && inTok && outTok) {
    return {
      id,
      action,
      kind: "swap",
      protocol: s.venue || undefined,
      from: inTok.symbol,
      to: outTok.symbol,
    };
  }

  if (action === "Borrow") {
    return {
      id,
      action,
      kind: "token",
      protocol: s.venue || undefined,
      market: s.market,
      token: (inTok ?? outTok)?.symbol ?? "",
      apy: s.apy ? s.apy.value * 100 : undefined,
      apyKind: "cost",
      detail: s.position ? mapDetail(s.position) : undefined,
    };
  }

  if (s.apy) {
    return {
      id,
      action,
      kind: "token",
      protocol: s.venue || undefined,
      market: s.market,
      token: (outTok ?? inTok)?.symbol ?? "",
      apy: s.apy.value * 100,
      apyKind: s.apy.kind,
      detail: s.position ? mapDetail(s.position) : undefined,
    };
  }

  // Supply / Deposit / Lend / Stake / Claim — show as single step with amount.
  const resolved = outTok ?? inTok;
  const raw = s.tokenOut ?? s.tokenIn;
  return {
    id,
    action,
    kind: "single",
    protocol: s.venue || undefined,
    market: s.market,
    token: resolved?.symbol ?? "",
    amount: raw && resolved && raw.amount !== "0"
      ? formatTokenAmount(raw.amount, resolved.decimals)
      : undefined,
  };
}

function mapDetail(p: { collateral: string; debt: string; ltv: number; lltv: number }): LeverageDetail {
  const pct = (v: number) => `${v <= 1 ? Math.round(v * 100) : Math.round(v)}%`;
  return { collateral: "—", ltv: pct(p.ltv), liq: pct(p.lltv), liqPrice: "—" };
}

// Build APY breakdown legs for the MetricRow.
// Prefer the structured apy block from the API response (collateralApy / borrowApy)
// as it carries source labels. Fall back to per-step apy data.
function buildLegsFromPreview(preview: Preview, steps: ApiStrategyStep[]): ApyLeg[] {
  const apyBlock = preview.apy;

  if (apyBlock) {
    const legs: ApyLeg[] = [];

    if (apyBlock.collateralApy && apyBlock.collateralApy.value != null && apyBlock.collateralApy.value !== 0) {
      legs.push({
        label: "Collateral",
        value: apyBlock.collateralApy.value * 100,
        kind: "yield",
      });
    }

    if (apyBlock.borrowApy && apyBlock.borrowApy.value != null && apyBlock.borrowApy.value !== 0) {
      legs.push({
        label: "Borrow",
        value: apyBlock.borrowApy.value * 100,
        kind: "cost",
      });
    }

    // If neither collateral nor borrow were populated, fall through to step-level.
    if (legs.length > 0) return legs;
  }

  // Deposit/swapAndDeposit intents have no step-level apy — use the per-protocol
  // allocation legs instead.
  if (preview.allocations) {
    return preview.allocations.legs
      .filter((l) => l.apy !== null && l.apy !== undefined)
      .map((l) => ({ label: l.protocol, value: (l.apy as number) * 100, kind: "yield" as const }));
  }

  // Step-level fallback: deduplicate by action label, prefer highest absolute value.
  return buildLegsFromSteps(steps);
}

function buildLegsFromSteps(steps: ApiStrategyStep[]): ApyLeg[] {
  const seen = new Map<string, ApyLeg>();
  for (const s of steps) {
    if (!s.apy || s.apy.value === 0) continue;
    const label = s.action;
    const existing = seen.get(label);
    if (!existing || Math.abs(s.apy.value) > Math.abs(existing.value)) {
      seen.set(label, {
        label,
        value: s.apy.value * 100,
        kind: s.apy.kind,
      });
    }
  }
  return Array.from(seen.values());
}




// Sim panel data extracted from a Preview's simulation result.
export type SimView = {
  balanceChanges: { token: string; before: string; after: string }[];
  gas: string;
};

export function extractSimView(preview: Preview): SimView {
  const balanceChanges = preview.simulation.balanceChanges.map((c) => {
    const known = KNOWN_TOKENS[(c.tokenAddress ?? "").toLowerCase()];
    const symbol = (c.symbol && c.symbol.trim()) || c.token || known?.symbol || "?";
    const decimals = c.decimals && c.decimals > 0 ? c.decimals : (known?.decimals ?? 18);
    return {
      token: symbol,
      before: formatTokenAmount(c.before, decimals),
      after: formatTokenAmount(c.after, decimals),
    };
  });
  return {
    balanceChanges,
    gas: `${formatTokenAmount(preview.simulation.gasCostNative, 18)} ETH`,
  };
}
