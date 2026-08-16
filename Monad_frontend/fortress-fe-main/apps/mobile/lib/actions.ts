// Smart Action catalog for the "/" picker.
//
// This is a TYPED STUB shaped exactly like the proposed `GET /actions?chainId=`
// response (see api-requirements.md B6). When the backend ships that endpoint,
// swap ACTION_GROUPS for a fetch/React-Query call — the types stay identical.
//
// Reflects the real prompt_2_defi tool registry, including honest `enabled`
// flags: aave.supply is a stub and morpho.multiply is disabled, so both are
// greyed out rather than advertised as working.

export type Action = {
  toolId: string;
  label: string;
  capability: string;
  chains: number[];
  enabled: boolean;
};

export type ActionGroup = {
  protocol: string;
  actions: Action[];
};

export const ACTION_GROUPS: ActionGroup[] = [
  {
    protocol: "LiFi",
    actions: [
      { toolId: "lifi.swap", label: "Swap", capability: "SWAP", chains: [1, 8453, 42161], enabled: true },
      { toolId: "lifi.bridge", label: "Bridge", capability: "BRIDGE", chains: [1, 8453, 42161, 10, 137], enabled: true },
    ],
  },
  {
    protocol: "Morpho",
    actions: [
      { toolId: "morpho.lend", label: "Lend", capability: "LEND", chains: [8453], enabled: true },
      { toolId: "morpho.supplyBorrow", label: "Supply & Borrow", capability: "SUPPLY_COLLATERAL", chains: [8453], enabled: true },
      { toolId: "morpho.multiply", label: "Multiply", capability: "MULTIPLY", chains: [8453], enabled: false },
    ],
  },
  {
    protocol: "Pendle",
    actions: [
      { toolId: "pendle.buyPt", label: "Buy PT", capability: "BUY_PT", chains: [8453], enabled: true },
      { toolId: "pendle.buyYt", label: "Buy YT", capability: "BUY_YT", chains: [8453], enabled: true },
      { toolId: "pendle.addLiquidity", label: "Add Liquidity", capability: "ADD_LIQUIDITY", chains: [8453], enabled: true },
    ],
  },
];

export const CHAINS: Record<number, { label: string; short: string; color: string }> = {
  1: { label: "Ethereum", short: "E", color: "#627EEA" },
  8453: { label: "Base", short: "B", color: "#2151F5" },
  42161: { label: "Arbitrum", short: "A", color: "#28A0F0" },
  10: { label: "Optimism", short: "O", color: "#FF0420" },
  137: { label: "Polygon", short: "P", color: "#8247E5" },
};

export function searchActions(groups: ActionGroup[], query: string): ActionGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((group) => ({
      ...group,
      actions: group.actions.filter(
        (action) =>
          action.label.toLowerCase().includes(q) ||
          action.capability.toLowerCase().includes(q) ||
          group.protocol.toLowerCase().includes(q) ||
          action.chains.some((c) => CHAINS[c]?.label.toLowerCase().includes(q)),
      ),
    }))
    .filter((group) => group.actions.length > 0);
}

// ─── Wizard steps: chain → token → amount ───────────────────────────────────
// Token lists + APY/TVL are stubbed pending GET /tokens + GET /markets (B7/B4).

export type WizardToken = {
  symbol: string;
  name: string;
  address: string; // display form, e.g. "0x8335…2913"
  apy?: number;
  tvlUsd?: number;
};

export const TOKENS_BY_CHAIN: Record<number, WizardToken[]> = {
  8453: [
    { symbol: "USDC", name: "USD Coin", address: "0x8335…2913", apy: 3.13, tvlUsd: 176_290_000 },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7…33Bf", apy: 0.01, tvlUsd: 144_190_000 },
    { symbol: "ETH", name: "Ether", address: "0x4200…0006", apy: 2.4, tvlUsd: 88_120_000 },
    { symbol: "cbETH", name: "Coinbase Wrapped ETH", address: "0x2Ae3…Ec22", apy: 2.1, tvlUsd: 44_450_000 },
    { symbol: "wstETH", name: "Wrapped stETH", address: "0xc1CB…e452", apy: 3.4, tvlUsd: 31_080_000 },
  ],
  1: [
    { symbol: "USDC", name: "USD Coin", address: "0xA0b8…eB48", apy: 4.1, tvlUsd: 412_000_000 },
    { symbol: "ETH", name: "Ether", address: "0xC02a…6Cc2", apy: 2.7, tvlUsd: 690_000_000 },
  ],
  42161: [
    { symbol: "USDC", name: "USD Coin", address: "0xaf88…5831", apy: 3.8, tvlUsd: 120_000_000 },
    { symbol: "ETH", name: "Ether", address: "0x82aF…Bab1", apy: 2.2, tvlUsd: 88_000_000 },
  ],
  10: [{ symbol: "USDC", name: "USD Coin", address: "0x0b2C…Ff85", apy: 3.2, tvlUsd: 22_000_000 }],
  137: [{ symbol: "USDC", name: "USD Coin", address: "0x3c49…5359", apy: 3.0, tvlUsd: 18_000_000 }],
};

export function tokensForChain(chainId: number): WizardToken[] {
  return TOKENS_BY_CHAIN[chainId] ?? [];
}

export type SmartAction = {
  toolId: string;
  label: string;
  protocol: string;
  chainId: number;
  token: { symbol: string; address: string };
  amountPct: number;
};

export function smartActionPhrase(a: SmartAction): string {
  const chain = CHAINS[a.chainId]?.label ?? "";
  return `${a.label} ${a.amountPct}% ${a.token.symbol} to ${a.protocol} on ${chain}`;
}

export function formatTvl(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(2)}K`;
  return `$${usd.toFixed(2)}`;
}
