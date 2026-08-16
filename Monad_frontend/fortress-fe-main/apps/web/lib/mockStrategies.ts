import type { StrategyDetail, StrategyStep } from "@fortress/core/types";

// Demo catalog used when the backend returns no public strategies, so the
// /strategies list and detail pages are explorable without live data.
// Amounts are raw integer strings (wei-style), matching the backend contract.

const USDC = { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 };
const WETH = { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 };
const CBETH = { symbol: "cbETH", address: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", decimals: 18 };
const CBBTC = { symbol: "cbBTC", address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", decimals: 8 };

const usdc = (n: number) => ({ ...USDC, amount: String(Math.round(n * 1e6)) });
const weth = (n: number) => ({ ...WETH, amount: `${Math.round(n * 1e6)}000000000000` });
const cbeth = (n: number) => ({ ...CBETH, amount: `${Math.round(n * 1e6)}000000000000` });
const cbbtc = (n: number) => ({ ...CBBTC, amount: String(Math.round(n * 1e8)) });

function step(
  s: Omit<StrategyStep, "chainId" | "toolId"> & Partial<Pick<StrategyStep, "chainId" | "toolId">>,
): StrategyStep {
  return { chainId: 8453, toolId: `${s.venue}.${s.action}`.toLowerCase(), ...s } as StrategyStep;
}

// catalogPrompt is the pre-filled prompt shown in the builder when a user
// clicks a strategy card from the /strategies catalog.
export type CatalogStrategy = StrategyDetail & { catalogPrompt: string };

export const MOCK_STRATEGIES: CatalogStrategy[] = [
  // 1 — cbBTC leverage loop from Ethereum
  {
    id: "cbbtc-loop-eth",
    catalogPrompt:
      "I have 1,000 USDC on Ethereum. Use LiFi to bridge 100% USDC from Ethereum to Base. Swap 100% USDC to cbBTC on Base. Supply 100% cbBTC as collateral to Morpho market cbBTC-USDC on Base. Borrow USDC at 75% LTV against cbBTC. Swap 100% borrowed USDC to cbBTC and supply 100% cbBTC as collateral.",
    name: "cbBTC Leverage Loop",
    walletAddress: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4",
    status: "entered",
    chainId: 8453,
    netApy: 18.4,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-01T10:00:00Z",
    exitCondition: "LTV exceeds 80%",
    planId: "plan_cbbtc_loop_eth",
    txHashes: [],
    description:
      "Bridges USDC from Ethereum to Base via LiFi, acquires cbBTC, and loops collateral on Morpho at 75% LTV for amplified BTC exposure.",
    gasSpentUsd: "2.10",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(1000), tokenOut: usdc(998), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(998), tokenOut: cbbtc(0.0152), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0152), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Borrow", venue: "Morpho", tokenOut: usdc(748), apy: { value: 6.5, kind: "cost" } }),
      step({ index: 4, action: "Swap", venue: "Uniswap", tokenIn: usdc(748), tokenOut: cbbtc(0.0114), apy: { value: 0, kind: "yield" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0114), apy: { value: 18.4, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-01T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 2 — cbETH 3x loop from Arbitrum
  {
    id: "cbeth-3x-loop-arb",
    catalogPrompt:
      "I have 500 USDT on Arbitrum. Use LiFi to bridge 100% USDT from Arbitrum to Base as USDC. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Then repeat 3 times: borrow USDC at 65% LTV, swap 100% borrowed USDC to WETH, wrap WETH into cbETH, and supply 100% cbETH.",
    name: "cbETH 3× Loop (Arbitrum)",
    walletAddress: "0xb2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5",
    status: "entered",
    chainId: 8453,
    netApy: 14.7,
    valueUsd: "500.00",
    depositUsd: "500.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-02T11:00:00Z",
    exitCondition: "LTV exceeds 72%",
    planId: "plan_cbeth_3x_arb",
    txHashes: [],
    description:
      "Bridges USDT from Arbitrum to Base, converts to cbETH, and loops 3 times on Morpho at 65% LTV for leveraged staking exposure.",
    gasSpentUsd: "3.20",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(500), tokenOut: usdc(498), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(498), tokenOut: weth(0.19), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Coinbase", tokenIn: weth(0.19), tokenOut: cbeth(0.188), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Supply", venue: "Morpho", tokenIn: cbeth(0.188), apy: { value: 3.1, kind: "yield" } }),
      step({ index: 4, action: "Borrow", venue: "Morpho", tokenOut: usdc(324), apy: { value: 5.8, kind: "cost" } }),
      step({ index: 5, action: "Swap", venue: "Uniswap", tokenIn: usdc(324), tokenOut: weth(0.123), apy: { value: 0, kind: "yield" } }),
      step({ index: 6, action: "Swap", venue: "Coinbase", tokenIn: weth(0.123), tokenOut: cbeth(0.122), apy: { value: 0, kind: "yield" } }),
      step({ index: 7, action: "Supply", venue: "Morpho", tokenIn: cbeth(0.122), apy: { value: 14.7, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-02T11:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 3 — ezETH 4x loop from Polygon
  {
    id: "ezeth-4x-loop-polygon",
    catalogPrompt:
      "I have 2,000 USDC on Polygon. Use LiFi to bridge 100% USDC from Polygon to Base. Swap 100% USDC to WETH. Wrap 100% WETH into ezETH. Supply 100% ezETH as collateral to Morpho market ezETH-USDC on Base. Then repeat 4 times: borrow USDC at 70% LTV, swap borrowed USDC to WETH, wrap WETH into ezETH, and supply 100% ezETH.",
    name: "ezETH 4× Loop (Polygon)",
    walletAddress: "0xc3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6",
    status: "entered",
    chainId: 8453,
    netApy: 22.1,
    valueUsd: "2000.00",
    depositUsd: "2000.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-03T09:30:00Z",
    exitCondition: "LTV exceeds 78%",
    planId: "plan_ezeth_4x_polygon",
    txHashes: [],
    description:
      "Bridges USDC from Polygon, wraps into ezETH, and loops 4 times on Morpho at 70% LTV for maximized restaking yield.",
    gasSpentUsd: "4.50",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(2000), tokenOut: usdc(1996), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(1996), tokenOut: weth(0.763), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Renzo", tokenIn: weth(0.763), tokenOut: weth(0.758), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Supply", venue: "Morpho", tokenIn: weth(0.758), apy: { value: 5.2, kind: "yield" } }),
      step({ index: 4, action: "Borrow", venue: "Morpho", tokenOut: usdc(1397), apy: { value: 6.1, kind: "cost" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: weth(0.53), apy: { value: 22.1, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-03T09:30:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 4 — Split cbBTC + cbETH from Ethereum
  {
    id: "split-cbbtc-cbeth-eth",
    catalogPrompt:
      "I have 1,500 USDC on Ethereum. Use LiFi to bridge 100% USDC from Ethereum to Base. Swap 50% USDC to cbBTC and 50% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbBTC to Morpho market cbBTC-USDC on Base and supply 100% cbETH to Morpho market cbETH-USDC on Base. Borrow USDC at 60% LTV against both collateral positions.",
    name: "Split cbBTC + cbETH Collateral",
    walletAddress: "0xd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607",
    status: "entered",
    chainId: 8453,
    netApy: 11.3,
    valueUsd: "1500.00",
    depositUsd: "1500.00",
    pnlUsd: "0.00",
    tags: ["Diversified", "Bridge", "Morpho"],
    deployedAt: "2026-06-04T14:00:00Z",
    exitCondition: "LTV exceeds 68%",
    planId: "plan_split_cbbtc_cbeth",
    txHashes: [],
    description:
      "Splits USDC equally between cbBTC and cbETH collateral on Morpho and borrows USDC at 60% LTV for a diversified leverage position.",
    gasSpentUsd: "3.80",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(1500), tokenOut: usdc(1497), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(748), tokenOut: cbbtc(0.0114), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Uniswap", tokenIn: usdc(749), tokenOut: weth(0.286), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Swap", venue: "Coinbase", tokenIn: weth(0.286), tokenOut: cbeth(0.284), apy: { value: 0, kind: "yield" } }),
      step({ index: 4, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0114), apy: { value: 0, kind: "yield" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: cbeth(0.284), apy: { value: 11.3, kind: "yield" } }),
      step({ index: 6, action: "Borrow", venue: "Morpho", tokenOut: usdc(898), apy: { value: 6.2, kind: "cost" } }),
    ],
    history: [{ at: "2026-06-04T14:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 5 — LBTC 2x loop from Optimism
  {
    id: "lbtc-2x-loop-op",
    catalogPrompt:
      "I have 750 USDC on Optimism. Use LiFi to bridge 100% USDC from Optimism to Base. Swap 100% USDC to cbBTC. Wrap 100% cbBTC into LBTC. Supply 100% LBTC as collateral to Morpho market LBTC-USDC on Base. Then repeat 2 times: borrow USDC at 80% LTV, swap borrowed USDC to cbBTC, wrap cbBTC into LBTC, and supply 100% LBTC.",
    name: "LBTC 2× Loop (Optimism)",
    walletAddress: "0xe5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718",
    status: "entered",
    chainId: 8453,
    netApy: 27.6,
    valueUsd: "750.00",
    depositUsd: "750.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-05T08:00:00Z",
    exitCondition: "LTV exceeds 85%",
    planId: "plan_lbtc_2x_op",
    txHashes: [],
    description:
      "Bridges USDC from Optimism, converts to LBTC, and loops twice on Morpho at 80% LTV for high-leverage BTC yield.",
    gasSpentUsd: "2.90",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(750), tokenOut: usdc(748), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(748), tokenOut: cbbtc(0.0114), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Lombard", tokenIn: cbbtc(0.0114), tokenOut: cbbtc(0.0113), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0113), apy: { value: 5.0, kind: "yield" } }),
      step({ index: 4, action: "Borrow", venue: "Morpho", tokenOut: usdc(598), apy: { value: 7.1, kind: "cost" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0091), apy: { value: 27.6, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-05T08:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 6 — Cross-chain yield: Base → Arbitrum
  {
    id: "cbbtc-base-to-arb-yield",
    catalogPrompt:
      "I have 5,000 USDC on Ethereum. Use LiFi to bridge 100% USDC from Ethereum to Base. Swap 100% USDC to cbBTC. Supply 100% cbBTC as collateral to Morpho market cbBTC-USDC on Base. Borrow USDC at 70% LTV against cbBTC. Use LiFi to bridge 100% borrowed USDC to Arbitrum and supply 100% USDC to a Morpho USDC vault on Arbitrum.",
    name: "cbBTC Base → Arbitrum Yield",
    walletAddress: "0xf60718293a4b5c6d7e8f90a1b2c3d4e5f6071829",
    status: "monitoring",
    chainId: 8453,
    netApy: 9.8,
    valueUsd: "5000.00",
    depositUsd: "5000.00",
    pnlUsd: "0.00",
    tags: ["Cross-chain", "Bridge", "Morpho"],
    deployedAt: "2026-06-06T12:00:00Z",
    exitCondition: "Arbitrum vault APY falls below 5%",
    planId: "plan_cbbtc_base_arb",
    txHashes: [],
    description:
      "Supplies cbBTC on Morpho Base, borrows USDC, then bridges borrowed USDC to Arbitrum to earn additional stablecoin yield.",
    gasSpentUsd: "5.20",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(5000), tokenOut: usdc(4990), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(4990), tokenOut: cbbtc(0.0759), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0759), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Borrow", venue: "Morpho", tokenOut: usdc(3493), apy: { value: 6.5, kind: "cost" } }),
      step({ index: 4, action: "Bridge", venue: "LiFi", tokenIn: usdc(3493), tokenOut: usdc(3486), apy: { value: 0, kind: "yield" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: usdc(3486), apy: { value: 9.8, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-06T12:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 7 — cbETH borrow and hold from BNB Chain
  {
    id: "cbeth-borrow-hold-bnb",
    catalogPrompt:
      "I have 1,000 USDT on BNB Chain. Use LiFi to bridge 100% USDT from BNB Chain to Base as USDC. Swap 100% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base. Borrow USDC at 60% LTV. Keep borrowed USDC in wallet for future deployments.",
    name: "cbETH Borrow & Hold (BNB)",
    walletAddress: "0x18293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b",
    status: "monitoring",
    chainId: 8453,
    netApy: 5.6,
    valueUsd: "1000.00",
    depositUsd: "1000.00",
    pnlUsd: "0.00",
    tags: ["Stablecoin", "Bridge", "Morpho"],
    deployedAt: "2026-06-07T16:00:00Z",
    exitCondition: "health factor drops below 1.3",
    planId: "plan_cbeth_borrow_hold_bnb",
    txHashes: [],
    description:
      "Bridges USDT from BNB Chain, wraps into cbETH, supplies on Morpho, and borrows USDC kept in wallet for future deployment.",
    gasSpentUsd: "3.10",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(1000), tokenOut: usdc(998), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(998), tokenOut: weth(0.381), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Coinbase", tokenIn: weth(0.381), tokenOut: cbeth(0.378), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Supply", venue: "Morpho", tokenIn: cbeth(0.378), apy: { value: 3.1, kind: "yield" } }),
      step({ index: 4, action: "Borrow", venue: "Morpho", tokenOut: usdc(599), apy: { value: 5.6, kind: "cost" } }),
    ],
    history: [{ at: "2026-06-07T16:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 8 — 70/30 cbBTC + cbETH split from Ethereum
  {
    id: "split-70-30-cbbtc-cbeth-eth",
    catalogPrompt:
      "I have 3,000 USDC on Ethereum. Use LiFi to bridge 100% USDC from Ethereum to Base. Swap 70% USDC to cbBTC and 30% USDC to WETH. Wrap 100% WETH into cbETH. Supply 100% cbBTC and 100% cbETH as collateral to their respective Morpho USDC markets on Base. Borrow USDC at 55% LTV against the combined collateral.",
    name: "70/30 cbBTC + cbETH Split",
    walletAddress: "0x293a4b5c6d7e8f90a1b2c3d4e5f6071829304b5c",
    status: "monitoring",
    chainId: 8453,
    netApy: 8.9,
    valueUsd: "3000.00",
    depositUsd: "3000.00",
    pnlUsd: "0.00",
    tags: ["Diversified", "Bridge", "Morpho"],
    deployedAt: "2026-06-08T10:00:00Z",
    exitCondition: "LTV exceeds 62%",
    planId: "plan_split_7030",
    txHashes: [],
    description:
      "Allocates 70% of bridged USDC to cbBTC and 30% to cbETH collateral on Morpho, borrowing at conservative 55% LTV.",
    gasSpentUsd: "4.30",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(3000), tokenOut: usdc(2994), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(2096), tokenOut: cbbtc(0.0319), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Uniswap", tokenIn: usdc(898), tokenOut: weth(0.343), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Swap", venue: "Coinbase", tokenIn: weth(0.343), tokenOut: cbeth(0.340), apy: { value: 0, kind: "yield" } }),
      step({ index: 4, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.0319), apy: { value: 0, kind: "yield" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: cbeth(0.340), apy: { value: 8.9, kind: "yield" } }),
      step({ index: 6, action: "Borrow", venue: "Morpho", tokenOut: usdc(1647), apy: { value: 6.0, kind: "cost" } }),
    ],
    history: [{ at: "2026-06-08T10:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 9 — ezETH 5x loop from Avalanche
  {
    id: "ezeth-5x-loop-avax",
    catalogPrompt:
      "I have 2,500 USDC on Avalanche. Use LiFi to bridge 100% USDC from Avalanche to Base. Swap 100% USDC to WETH. Wrap 100% WETH into ezETH. Supply 100% ezETH as collateral to Morpho market ezETH-USDC on Base. Then repeat 5 times: borrow USDC at 65% LTV, swap borrowed USDC to WETH, wrap WETH into ezETH, and supply 100% ezETH.",
    name: "ezETH 5× Loop (Avalanche)",
    walletAddress: "0x3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d",
    status: "entered",
    chainId: 8453,
    netApy: 31.4,
    valueUsd: "2500.00",
    depositUsd: "2500.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-09T09:00:00Z",
    exitCondition: "LTV exceeds 75%",
    planId: "plan_ezeth_5x_avax",
    txHashes: [],
    description:
      "Bridges USDC from Avalanche, wraps into ezETH, and aggressively loops 5 times on Morpho at 65% LTV for maximum restaking leverage.",
    gasSpentUsd: "5.80",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(2500), tokenOut: usdc(2495), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(2495), tokenOut: weth(0.954), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Swap", venue: "Renzo", tokenIn: weth(0.954), tokenOut: weth(0.949), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Supply", venue: "Morpho", tokenIn: weth(0.949), apy: { value: 5.2, kind: "yield" } }),
      step({ index: 4, action: "Borrow", venue: "Morpho", tokenOut: usdc(1622), apy: { value: 6.3, kind: "cost" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: weth(0.617), apy: { value: 31.4, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-09T09:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,

  // 10 — cbBTC 6x loop from Ethereum (whale)
  {
    id: "cbbtc-6x-loop-eth-whale",
    catalogPrompt:
      "I have 10,000 USDC on Ethereum. Use LiFi to bridge 100% USDC from Ethereum to Base. Swap 100% USDC to cbBTC. Supply 100% cbBTC as collateral to Morpho market cbBTC-USDC on Base. Then repeat 6 times: borrow USDC at 75% LTV against cbBTC, swap 100% borrowed USDC to cbBTC, and supply 100% cbBTC as collateral.",
    name: "cbBTC 6× Loop (Whale)",
    walletAddress: "0x4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e",
    status: "entered",
    chainId: 8453,
    netApy: 42.3,
    valueUsd: "10000.00",
    depositUsd: "10000.00",
    pnlUsd: "0.00",
    tags: ["Leverage", "Bridge", "Morpho"],
    deployedAt: "2026-06-10T07:00:00Z",
    exitCondition: "LTV exceeds 82%",
    planId: "plan_cbbtc_6x_eth",
    txHashes: [],
    description:
      "High-conviction cbBTC leverage strategy that loops 6 times on Morpho at 75% LTV for compounding BTC-denominated yield.",
    gasSpentUsd: "8.40",
    steps: [
      step({ index: 0, action: "Bridge", venue: "LiFi", tokenIn: usdc(10000), tokenOut: usdc(9980), apy: { value: 0, kind: "yield" } }),
      step({ index: 1, action: "Swap", venue: "Uniswap", tokenIn: usdc(9980), tokenOut: cbbtc(0.1518), apy: { value: 0, kind: "yield" } }),
      step({ index: 2, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.1518), apy: { value: 0, kind: "yield" } }),
      step({ index: 3, action: "Borrow", venue: "Morpho", tokenOut: usdc(7485), apy: { value: 7.2, kind: "cost" } }),
      step({ index: 4, action: "Swap", venue: "Uniswap", tokenIn: usdc(7485), tokenOut: cbbtc(0.1139), apy: { value: 0, kind: "yield" } }),
      step({ index: 5, action: "Supply", venue: "Morpho", tokenIn: cbbtc(0.1139), apy: { value: 42.3, kind: "yield" } }),
    ],
    history: [{ at: "2026-06-10T07:00:00Z", event: "Strategy deployed" }],
  } as unknown as CatalogStrategy,
];

export function findMockStrategy(id: string): CatalogStrategy | undefined {
  return MOCK_STRATEGIES.find((s) => s.id === id);
}
