import type { StrategyDetail, StrategyStep } from "@fortress/core/types";

// Demo catalog used when the backend returns no public strategies, so the
// /strategies list and detail pages are explorable without live data.
// Amounts are raw integer strings (wei-style), matching the backend contract.
//
// These mirror Monad_Backend/src/core/services/strategies/catalog.ts. That
// matters because `catalogPrompt` is pre-filled into the builder when a card is
// clicked — a prompt describing something the backend cannot execute produces
// an immediate refusal, which is a worse first impression than an empty list.
//
// The previous version of this file held ten Base leverage loops (cbBTC/cbETH/
// ezETH/LBTC collateral on Morpho, bridged in from Ethereum/Arbitrum/Polygon).
// None of it is executable on Monad: the Morpho leverage and strategy
// executors are not deployed there, so "strategy" and "leverage" are not even
// registered actions. Add loop strategies back alongside those executors.

const CHAIN_ID = 143;

const USDC = { symbol: "USDC", address: "0x754704bc059f8c67012fed69bc8a327a5aafb603", decimals: 6 };

const usdc = (n: number) => ({ ...USDC, amount: String(Math.round(n * 1e6)) });

// Venue share tokens. Amounts are illustrative, not quoted — this is the
// offline fallback, and the live catalog carries real previews.
const share = (symbol: string, address: string) => (n: number) => ({
  symbol,
  address,
  decimals: 18,
  amount: `${Math.round(n * 1e6)}000000000000`,
});

const aMonUsdc = share("aMonUSDC", "0x35a73bacb179d3740395a3cecc87ff2e581d6042");
const nUsdc = share("nUSDC", "0x38648958836ea88b368b4ac23b86ad44b0fe7508");
const eUsdc = share("eUSDC", "0x1905eddf5943ef6c92ccf1469bd40fc2cb4a77b0");
const cUsdc = share("cUSDC", "0x21adbb60a5fb909e7f1fb48aacc4569615cd97b5");

function step(
  s: Omit<StrategyStep, "chainId" | "toolId"> & Partial<Pick<StrategyStep, "chainId" | "toolId">>,
): StrategyStep {
  return { chainId: CHAIN_ID, toolId: `${s.venue}.${s.action}`.toLowerCase(), ...s } as StrategyStep;
}

// catalogPrompt is the pre-filled prompt shown in the builder when a user
// clicks a strategy card from the /strategies catalog.
export type CatalogStrategy = StrategyDetail & { catalogPrompt: string };

export const MOCK_STRATEGIES: CatalogStrategy[] = [
  // 1 — single venue, deepest USDC market on the chain
  {
    id: "aave-usdc-single",
    catalogPrompt: "I have 1 USDC on Monad. Deposit 100% into Aave.",
    name: "Aave V3 USDC Supply",
    walletAddress: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    status: "entered",
    chainId: CHAIN_ID,
    netApy: 3.12,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Deposit", "Aave"],
    deployedAt: "2026-08-01T10:00:00Z",
    exitCondition: "Manual",
    planId: "plan_aave_usdc_single",
    txHashes: [],
    description:
      "Supplies USDC to Aave V3 Monad — the deepest USDC venue on the chain, with roughly 108M of open capacity against a 250M supply cap.",
    gasSpentUsd: "0.02",
    steps: [
      step({ index: 0, action: "Supply", venue: "Aave", tokenIn: usdc(1000), tokenOut: aMonUsdc(1000), apy: { value: 3.12, kind: "yield" } }),
    ],
    history: [{ at: "2026-08-01T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 2 — two venues, different codebases
  {
    id: "usdc-split-aave-euler",
    catalogPrompt: "I have 1 USDC on Monad. Deposit 60% into Aave and 40% into Euler.",
    name: "USDC Split: Aave + Euler",
    walletAddress: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    status: "entered",
    chainId: CHAIN_ID,
    netApy: 5.82,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Deposit", "Aave", "Euler"],
    deployedAt: "2026-08-01T10:00:00Z",
    exitCondition: "Manual",
    planId: "plan_usdc_split_aave_euler",
    txHashes: [],
    description:
      "Splits USDC across Aave V3 Monad and the Euler eUSDC vault, so the position is not concentrated in a single lending market.",
    gasSpentUsd: "0.03",
    steps: [
      step({ index: 0, action: "Supply", venue: "Aave", tokenIn: usdc(600), tokenOut: aMonUsdc(600), apy: { value: 3.12, kind: "yield" } }),
      step({ index: 1, action: "Supply", venue: "Euler", tokenIn: usdc(400), tokenOut: eUsdc(400), apy: { value: 9.87, kind: "yield" } }),
    ],
    history: [{ at: "2026-08-01T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 3 — three independent lending codebases
  {
    id: "usdc-split-three-venue",
    catalogPrompt:
      "I have 1 USDC on Monad. Deposit 50% into Aave, 25% into Euler and 25% into Curvance.",
    name: "USDC Three-Venue Spread",
    walletAddress: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    status: "entered",
    chainId: CHAIN_ID,
    netApy: 4.03,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Deposit", "Diversified"],
    deployedAt: "2026-08-01T10:00:00Z",
    exitCondition: "Manual",
    planId: "plan_usdc_split_three_venue",
    txHashes: [],
    description:
      "Spreads USDC across Aave V3, Euler and Curvance to diversify protocol risk across three independent lending codebases.",
    gasSpentUsd: "0.04",
    steps: [
      step({ index: 0, action: "Supply", venue: "Aave", tokenIn: usdc(500), tokenOut: aMonUsdc(500), apy: { value: 3.12, kind: "yield" } }),
      step({ index: 1, action: "Supply", venue: "Euler", tokenIn: usdc(250), tokenOut: eUsdc(250), apy: { value: 9.87, kind: "yield" } }),
      step({ index: 2, action: "Supply", venue: "Curvance", tokenIn: usdc(250), tokenOut: cUsdc(250), apy: { value: 0, kind: "yield" } }),
    ],
    history: [{ at: "2026-08-01T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 4 — the two Aave V3 markets on the chain
  {
    id: "usdc-aave-neverland",
    catalogPrompt: "I have 1 USDC on Monad. Deposit 70% into Aave and 30% into Neverland.",
    name: "Aave V3 + Neverland",
    walletAddress: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    status: "entered",
    chainId: CHAIN_ID,
    netApy: 2.76,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Deposit", "Aave", "Neverland"],
    deployedAt: "2026-08-01T10:00:00Z",
    exitCondition: "Manual",
    planId: "plan_usdc_aave_neverland",
    txHashes: [],
    description:
      "Splits across both Aave V3 markets on Monad. Neverland runs the same codebase at an older revision, with a 4000 bps reserve factor against Aave's 1000 — so it pays noticeably less.",
    gasSpentUsd: "0.03",
    steps: [
      step({ index: 0, action: "Supply", venue: "Aave", tokenIn: usdc(700), tokenOut: aMonUsdc(700), apy: { value: 3.12, kind: "yield" } }),
      step({ index: 1, action: "Supply", venue: "Neverland", tokenIn: usdc(300), tokenOut: nUsdc(300), apy: { value: 1.92, kind: "yield" } }),
    ],
    history: [{ at: "2026-08-01T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,
];

export function findMockStrategy(id: string): CatalogStrategy | undefined {
  return MOCK_STRATEGIES.find((s) => s.id === id);
}
