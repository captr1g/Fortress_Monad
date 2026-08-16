import { EvmSimulationResult, EvmTransaction } from "@chains/evm/types.js";
import type { PositionView, ExitSettlement } from "./exit.js";

export type MorphoMarketItem = {
  loanAsset: { address: string };
  collateralAsset: { address: string };
  oracle: { address: string };
  irmAddress: string;
  lltv: string;
  state?: { supplyAssetsUsd?: number };
};

export type MorphoMarketParams = {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
};

export type MorphoInOut = {
  collateralToken: `0x${string}`;
  loanToken: `0x${string}`;
};

//The user's existing on-chain position in a market, used to seed the projection.
export type ExistingMarketPosition = {
  collateral: bigint;
  debt: bigint;
};

export type OnChainStep = {
  adapterId: number;
  action: number;
  tokenIn: `0x${string}`;
  bps: number;
  amountFixed: bigint;
  data: `0x${string}`;
};

export type ProjectedState = {
  balances: Map<string, bigint>;
  collateral: Map<string, bigint>;
  debt: Map<string, bigint>;
};

export type DepositLeg = {
  protocol: string;
  bps: number;
  apy: number | null;
  status: "ok" | "unavailable";
  // The specific underlying vault/wrapper token this leg actually deposits
  // into (e.g. "mwUSDC" for Morpho, or a Pendle market label like
  // "40acresUSDC") — the protocol name alone is a brand, not the contract
  // holding the funds, so this is shown alongside it in the UI.
  market?: string;
  // On-chain address behind `market`, so the frontend can offer it for verification.
  marketAddress?: string;
};

export type DepositApy = {
  status: "ok" | "partial" | "unavailable";
  netApy: number | null; // bps-weighted blend across legs, null if any leg unavailable
  legs: DepositLeg[];
};

export type ExitAmounts = {
  repayAssets: bigint;
  withdrawAssets: bigint;
  collateralToSell: bigint;
  collateralReturned: bigint;
};

export type ExitResult = {
  description: string;
  transactions: EvmTransaction[];
  simulation: EvmSimulationResult;
  position: PositionView;
  settlement: ExitSettlement;
};

export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const WAD = 10n ** 18n;

export const VIRTUAL_SHARES = 1_000_000n;
export const VIRTUAL_ASSETS = 1n;

export const SWAP_SLIPPAGE = 0.005;
export const MIN_OUT_BPS = 9950n; // accept ≥ 99.5% of the quoted output
