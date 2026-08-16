// Local strategy model + demo data for the builder screen.
// NOTE: this is intentionally framework-free so it can move to
// `packages/core/schemas` (zod) + `packages/core/types` when we wire the
// real backend (prompt_2_defi). Components must stay logic-free per CLAUDE.md.

export type StepKind = "single" | "swap" | "token";
export type ApyKind = "yield" | "cost";

export type LeverageDetail = {
  collateral: string;
  ltv: string;
  liq: string;
  liqPrice: string;
};

export type StrategyStep = {
  id: string;
  action: string;
  kind: StepKind;
  protocol?: string;
  /** The specific vault/market this step's funds actually land in (e.g. "mwUSDC", or a Morpho market like "cbETH-USDC"). */
  market?: string;
  /** On-chain address behind `market`, if known — shown on hover. */
  marketAddress?: string;
  token?: string;
  amount?: string;
  from?: string;
  to?: string;
  apy?: number;
  apyKind?: ApyKind;
  detail?: LeverageDetail;
  loop?: {
    position: "start" | "inside" | "end";
    iterations?: number;
  };
};

export type ApyLeg = { label: string; value: number; kind: ApyKind };

// A flat "deposit $X, split across protocols by allocation %" plan (the
// backend's deposit/swapAndDeposit intents) — no ordered steps to walk.
export type AllocationLeg = { protocol: string; bps: number; apy: number | null; status?: string; market?: string; marketAddress?: string };
export type Allocation = { token: string; amount: string; decimals: number; legs: AllocationLeg[] };

export type Strategy = {
  name: string;
  chain: string;
  startingToken: string;
  prompt: string;
  netApy: number;
  protocolsUsed: number;
  legs: ApyLeg[];
  steps: StrategyStep[];
  allocations?: Allocation;
  /** collateralValue / equity — undefined for non-leveraged plans. */
  leverage?: number;
};

export type StrategySummary = {
  chain: string;
  startingToken: string;
  startingAmount?: string;
  /** Distinct tokens touched anywhere in the plan, in step order. */
  tokens: string[];
  netApy: number;
  protocolsUsed: number;
  leverage?: number;
};

// Card/detail-page summary for a saved strategy — everything scannable at a
// glance without re-reading the full step list or the raw prompt.
export function strategySummary(strategy: Strategy): StrategySummary {
  const startingAmount =
    strategy.allocations?.amount ?? strategy.steps.find((s) => s.kind === "single")?.amount;

  const tokens: string[] = [];
  const seen = new Set<string>();
  const addToken = (t?: string) => {
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  };
  addToken(strategy.startingToken);
  for (const step of strategy.steps) {
    addToken(step.token);
    addToken(step.from);
    addToken(step.to);
  }
  if (strategy.allocations) addToken(strategy.allocations.token);

  return {
    chain: strategy.chain,
    startingToken: strategy.startingToken,
    startingAmount,
    tokens,
    netApy: strategy.netApy,
    protocolsUsed: strategy.protocolsUsed,
    leverage: strategy.leverage,
  };
}

export const PROMPT_EXAMPLES = [
  "Swap and bridge",
  "Lend and borrow",
  "Buy PT / YT",
  "Long / short perp",
];

export const SUPPORTED_PROTOCOLS = ["Aave", "Euler", "Fluid", "Morpho", "Pendle"];

// Brand accents — used sparingly, only on token/protocol icons for scannability.
const TOKEN_COLORS: Record<string, string> = {
  ETH: "#627EEA",
  USDC: "#2775CA",
  cbETH: "#0052FF",
  cbBTC: "#F7931A",
  wstETH: "#00A3FF",
  "PT-USDC": "#1FC7A8",
  Rewards: "#6b6b73",
};

const PROTOCOL_COLORS: Record<string, string> = {
  Kyber: "#31CB9E",
  Aave: "#B6509E",
  Uniswap: "#FF007A",
  Morpho: "#2C6EF2",
  Lido: "#00A3FF",
  Pendle: "#1FC7A8",
  Merkl: "#F5A623",
  LiFi: "#5C67DE",
};

export const tokenColor = (sym?: string) =>
  (sym && TOKEN_COLORS[sym]) || "#6b6b73";
export const protocolColor = (name?: string) =>
  (name && PROTOCOL_COLORS[name]) || "#6b6b73";
