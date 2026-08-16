// Smart Action catalog for the "/" picker.
//
// This is a TYPED STUB shaped exactly like the proposed `GET /actions?chainId=`
// response (see api-requirements.md B6). When the backend ships that endpoint,
// swap ACTION_GROUPS for a fetch/React-Query call — the types stay identical.
//
// Reflects the real backend capability registry, including honest `enabled`
// flags: anything the backend cannot currently build calldata for is greyed
// out rather than advertised as working.

const MONAD = 143;

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

// Mirrors apps/web/lib/actions.ts and the backend capability registry.
export const ACTION_GROUPS: ActionGroup[] = [
  {
    protocol: "Aave",
    actions: [
      { toolId: "aave.lend", label: "Lend", capability: "DEPOSIT", chains: [MONAD], enabled: true },
      { toolId: "aave.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [MONAD], enabled: true },
    ],
  },
  {
    protocol: "Neverland",
    actions: [
      { toolId: "neverland.lend", label: "Lend", capability: "DEPOSIT", chains: [MONAD], enabled: true },
      { toolId: "neverland.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [MONAD], enabled: true },
    ],
  },
  {
    protocol: "Euler",
    actions: [
      { toolId: "euler.lend", label: "Lend", capability: "DEPOSIT", chains: [MONAD], enabled: true },
      { toolId: "euler.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [MONAD], enabled: true },
    ],
  },
  {
    protocol: "Curvance",
    actions: [
      { toolId: "curvance.lend", label: "Lend", capability: "DEPOSIT", chains: [MONAD], enabled: true },
      { toolId: "curvance.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [MONAD], enabled: true },
    ],
  },
  {
    protocol: "Morpho",
    actions: [
      { toolId: "morpho.lend", label: "Lend", capability: "DEPOSIT", chains: [MONAD], enabled: true },
      { toolId: "morpho.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [MONAD], enabled: true },
      { toolId: "morpho.supplyBorrow", label: "Supply & Borrow", capability: "SUPPLY_COLLATERAL", chains: [MONAD], enabled: false },
      { toolId: "morpho.multiply", label: "Multiply", capability: "MULTIPLY", chains: [MONAD], enabled: false },
    ],
  },
  {
    protocol: "shMONAD",
    actions: [
      { toolId: "shmonad.stake", label: "Stake", capability: "DEPOSIT", chains: [MONAD], enabled: false },
    ],
  },
  {
    protocol: "LiFi",
    actions: [
      { toolId: "lifi.swap", label: "Swap", capability: "SWAP", chains: [MONAD], enabled: true },
      { toolId: "lifi.bridge", label: "Bridge", capability: "BRIDGE", chains: [MONAD, 1, 42161, 10], enabled: true },
    ],
  },
];

// Monad executes; the rest appear only as LiFi bridge destinations.
export const CHAINS: Record<number, { label: string; short: string; color: string }> = {
  [MONAD]: { label: "Monad", short: "M", color: "#836EF9" },
  1: { label: "Ethereum", short: "E", color: "#627EEA" },
  42161: { label: "Arbitrum", short: "A", color: "#28A0F0" },
  10: { label: "Optimism", short: "O", color: "#FF0420" },
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

// Display-only fallback for the wizard. Truncated addresses are for the chip
// label; the real values come from GET /fortress/registry.
export const TOKENS_BY_CHAIN: Record<number, WizardToken[]> = {
  [MONAD]: [
    { symbol: "USDC", name: "USD Coin", address: "0x7547…b603" },
    { symbol: "WMON", name: "Wrapped Monad", address: "0x3bd3…433A" },
    { symbol: "WETH", name: "Wrapped Ether", address: "0xEE8c…1242" },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x0555…2B9c" },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xd18B…414b" },
    { symbol: "USDT0", name: "Tether USD", address: "0xe7cd…c82D" },
    { symbol: "AUSD", name: "Agora Dollar", address: "0x0000…012a" },
    { symbol: "shMON", name: "FastLane Staked MON", address: "0x1B68…E19c" },
  ],
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
