// Smart Action catalog for the "/" picker.
//
// This is a TYPED STUB shaped exactly like the proposed `GET /actions?chainId=`
// response (see api-requirements.md B6). When the backend ships that endpoint,
// swap ACTION_GROUPS for a fetch/React-Query call — the types stay identical.
//
// Reflects the real prompt_2_defi tool registry, including honest `enabled`
// flags: aave.supply is a stub and morpho.multiply is disabled, so both are
// greyed out rather than advertised as working.

import type { RegistryChain } from "@fortress/core";

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
  {
    protocol: "Fluid",
    actions: [
      { toolId: "fluid.lend", label: "Lend", capability: "DEPOSIT", chains: [8453], enabled: true },
      { toolId: "fluid.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [8453], enabled: true },
    ],
  },
  {
    protocol: "Euler",
    actions: [
      { toolId: "euler.lend", label: "Lend", capability: "DEPOSIT", chains: [8453], enabled: true },
      { toolId: "euler.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [8453], enabled: true },
    ],
  },
  {
    protocol: "CompoundV3",
    actions: [
      { toolId: "compound.lend", label: "Lend", capability: "DEPOSIT", chains: [8453], enabled: true },
      { toolId: "compound.withdraw", label: "Withdraw", capability: "WITHDRAW", chains: [8453], enabled: true },
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
// Token lists come from the live `GET /fortress/registry` endpoint (see
// `useRegistry` in @fortress/core/hooks) — the same registry the backend
// resolves addresses against, so the picker can never drift from what the
// planner actually accepts. APY/TVL aren't in the registry response yet
// (pending B4), so they're left undefined and the UI hides them.

export type WizardToken = {
  symbol: string;
  name: string;
  address: string;
  apy?: number;
  tvlUsd?: number;
};

/** Maps a registry chain's tokens to the wizard's token shape. */
export function tokensFromRegistryChain(chain: RegistryChain | undefined): WizardToken[] {
  if (!chain) return [];
  return chain.tokens.map((t) => ({ symbol: t.symbol, name: t.name, address: t.address }));
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
