import type { MorphoMarketParams } from "@domains/yield/types/market.js";

// A market the wallet holds a leveraged position in, discovered via Morpho GraphQL.
export type DiscoveredMarket = {
  marketKey: `0x${string}`;
  params: MorphoMarketParams;
};

// A wallet's position snapshot, all amounts as decimal strings (bigint-safe over JSON).
// oracle/irm/lltvWad are persisted so the poller can rebuild the market for on-chain
// reads without re-hitting GraphQL.
export type StoredPosition = {
  wallet: string;
  marketKey: string;
  collateralToken: string;
  loanToken: string;
  oracle: string;
  irm: string;
  lltvWad: string;
  collateral: string;
  debt: string;
  collateralValue: string;
  ltv: number;
  lltv: number;
  netApy: number | null;
  updatedAt: string;
};

export type PositionsResponse = {
  positions: StoredPosition[];
  asOf: string | null;
  stale: boolean;
};
