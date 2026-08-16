// Smart Action catalog for the "/" picker.
//
// This is a TYPED STUB shaped exactly like the proposed `GET /actions?chainId=`
// response (see api-requirements.md B6). When the backend ships that endpoint,
// swap ACTION_GROUPS for a fetch/React-Query call — the types stay identical.
//
// Reflects the real backend capability registry, including honest `enabled`
// flags: anything the backend cannot currently build calldata for is greyed
// out rather than advertised as working.

import type { RegistryChain } from "@fortress/core";
import { MONAD_CHAIN_ID as MONAD } from "./chains";

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

// Mirrors what Monad_Backend/src/boot.ts actually registers as capabilities.
// `enabled: false` means the venue exists on-chain but the backend cannot
// build calldata for it yet — greyed out rather than advertised as working.
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
      // The Hyperithm USDC Apex vault is registered but currently at cap
      // (maxDeposit() == 0), and the leverage executor is not deployed at all.
      { toolId: "morpho.supplyBorrow", label: "Supply & Borrow", capability: "SUPPLY_COLLATERAL", chains: [MONAD], enabled: false },
      { toolId: "morpho.multiply", label: "Multiply", capability: "MULTIPLY", chains: [MONAD], enabled: false },
    ],
  },
  {
    protocol: "shMONAD",
    actions: [
      // Registered on FortVault, but its adapter takes an encoded USDC->MON
      // swap route the backend has no builder for yet.
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
