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

export const STRATEGY_CATALOG: CuratedStrategy[] = [
  {
    id: "cbeth-single-borrow-55",
    title: "cbETH supply + single borrow (30% LTV)",
    summary:
      "Swap USDC into cbETH, supply to Morpho cbETH-USDC, borrow USDC once at 30% LTV.",
    prompt:
      "I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Borrow USDC at 30% LTV against cbETH.",
  },
  {
    id: "cbeth-loop-2x-50",
    title: "cbETH 2-loop leverage (35% LTV)",
    summary:
      "Build a leveraged cbETH position by looping borrow → swap → supply twice at 35% LTV.",
    prompt:
      "I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Then repeat 2 times: borrow USDC at 35% LTV, swap borrowed USDC to WETH, wrap WETH into cbETH, and supply 100% cbETH.",
  },
  {
    id: "cbeth-borrow-redeploy-55",
    title: "cbETH borrow + redeploy (30% LTV)",
    summary:
      "Supply cbETH, borrow USDC at 55% LTV, then redeploy the borrowed USDC back into cbETH collateral.",
    prompt:
      "I have 1 USDC on Base. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Borrow USDC at 30% LTV against cbETH. Swap 100% borrowed USDC to WETH, wrap WETH into cbETH, and supply 100% cbETH.",
  },
  {
    id: "multi-collateral-cbeth-cbbtc-50",
    title: "cbETH + cbBTC multi-collateral (50% LTV)",
    summary:
      "Split into cbETH and cbBTC, supply both to their Morpho markets, borrow USDC at 50% LTV against the combined collateral.",
    prompt:
      "I have 2 USDC on Base. Swap 70% USDC to WETH and 30% USDC to cbBTC. Wrap 100% WETH into cbETH. Supply 100% cbETH and 100% cbBTC to their respective Morpho markets on Base. Borrow USDC at 50% LTV against the combined collateral.",
  },
];

// Catalog previews run against a funded reference wallet so balance-dependent steps
// (e.g. "swap 100%") size correctly during the build. No transaction is signed.
export const PREVIEW_WALLET =
  "0x24d593016eFcF6B43871A703300812a3271dD638" as const;
