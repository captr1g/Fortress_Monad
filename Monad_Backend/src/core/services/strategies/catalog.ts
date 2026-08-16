// Curated strategy catalog surfaced by GET /fortress/strategies. Each entry is a
// natural-language prompt run through the same planner → build → APY pipeline used
// by /fortress/plan, so the displayed net APY and market rates stay live.
//
// `id` is a stable slug the frontend can key off; `title`/`summary` are display-only.

export type CuratedStrategy = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
};

// Every entry is a plain USDC deposit or split-deposit. The Base catalog this
// replaced was four Morpho collateral/borrow loops; on Monad the executors that
// build those (FortStrategyExecutor, MorphoLeverageExecutor) are not deployed,
// so "strategy" and "leverage" are unregistered capabilities and any looped
// prompt here would seed as a permanent build error. Add loop strategies back
// alongside those capabilities once the executors are live.
//
// Venues below are exactly the ones registered on FortVault and reachable from
// the backend today — see boot.ts registerCapabilities.
export const STRATEGY_CATALOG: CuratedStrategy[] = [
  {
    id: "aave-usdc-single",
    title: "Aave V3 USDC supply",
    summary:
      "Supply USDC to Aave V3 Monad — the deepest USDC venue on the chain, with roughly 108M of open capacity.",
    prompt: "I have 1 USDC on Monad. Deposit 100% into Aave.",
  },
  {
    id: "usdc-split-aave-euler",
    title: "USDC split: Aave V3 + Euler",
    summary:
      "Split USDC across Aave V3 Monad and the Euler eUSDC vault, so the position is not concentrated in one lending market.",
    prompt:
      "I have 1 USDC on Monad. Deposit 60% into Aave and 40% into Euler.",
  },
  {
    id: "usdc-split-three-venue",
    title: "USDC three-venue spread",
    summary:
      "Spread USDC across Aave V3, Euler and Curvance to diversify protocol risk across three independent lending codebases.",
    prompt:
      "I have 1 USDC on Monad. Deposit 50% into Aave, 25% into Euler and 25% into Curvance.",
  },
  {
    id: "usdc-aave-neverland",
    title: "Aave V3 + Neverland",
    summary:
      "Split across the two Aave V3 markets on Monad. Neverland is the same codebase at an older revision, with a higher reserve factor and a lower supply rate.",
    prompt:
      "I have 1 USDC on Monad. Deposit 70% into Aave and 30% into Neverland.",
  },
];

// Catalog previews run against a funded reference wallet so balance-dependent steps
// (e.g. "swap 100%") size correctly during the build. No transaction is signed.
export const PREVIEW_WALLET =
  "0x24d593016eFcF6B43871A703300812a3271dD638" as const;
