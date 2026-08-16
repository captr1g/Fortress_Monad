export type Protocol = "aave" | "morpho" | "staking";

export type Market = {
  marketId: string;
  protocol: Protocol;
  chainId: number;
  name: string;
  reserveAddress: string | null;
  marketKey: string | null;
  enabled: boolean;
};

// Supply is +
// Borrow is -
// reward is +
export type MarketRates = {
  supplyApy: number;
  borrowApy: number | null;
  rewardsApy: number | null;
};

export type StoredRates = MarketRates & {
  updatedAt: string;
};

export interface ApyAdapter {
  protocol: Protocol;
  getRatesBatch(
    markets: Market[],
    chainId: number,
  ): Promise<Map<string, MarketRates>>;
  /**
   * Whether this adapter can serve the given chain at all. Distinguishes a
   * permanent misconfiguration ("no Aave pool for chain 8453" — retrying will
   * never help) from a transient RPC failure. The poller skips unsupported
   * chains with one warning instead of burning the retry budget and printing a
   * stack trace on every tick. Omit to mean "every chain".
   */
  supportsChain?(chainId: number): boolean;
}

export type ApyTermStatus = "ok" | "unavailable";

export type ApyRates = {
  supplyApy: number;
  borrowApy: number | null;
  rewardsApy: number | null;
};

export type ResolvedApy = {
  status: ApyTermStatus;
  rates: ApyRates | null;
  updatedAt: string | null;
};

export type ApyMarketDescriptor =
  | { kind: "morpho"; chainId: number; marketKey: `0x${string}`; name: string }
  | { kind: "staking"; chainId: number; token: `0x${string}`; name: string };

export interface ApyResolverPort {
  resolve(descriptor: ApyMarketDescriptor): Promise<ResolvedApy>;
}

export type ApyTerm = {
  value: number | null;
  status: ApyTermStatus;
  source: "morpho" | "staking";
  token?: `0x${string}`;
  market?: string;
  updatedAt: string | null;
};

export type StepApy = {
  index: number;
  action: string;
  apy: number | null;
  kind: "earn" | "cost" | "neutral";
  token?: `0x${string}`;
  status: ApyTermStatus;
};

export type StrategyLeg = {
  marketKey: string;
  marketKeyHash: string;
  collateralToken: `0x${string}`;
  collateralValue: number;
  debtValue: number;
};

export type StrategyLegRates = {
  collateralApy: number | null;
  collateralStatus: ApyTermStatus;
  borrowApy: number | null;
  borrowStatus: ApyTermStatus;
  rewardsApy: number;
};

export type StrategySnapshot = {
  legs: StrategyLeg[];
  idleCash: number;
};

export type AggregatedApy = {
  status: "ok" | "unavailable";
  equity: number;
  leverage: number;
  netApy: number | null;
  collateralApy: number | null;
  borrowApy: number | null;
};

export type StrategyApy = {
  status: "ok" | "unavailable";
  asOf: string;
  leverage: number;
  collateralApy: ApyTerm;
  borrowApy: ApyTerm;
  baseApy: number | null;
  netApy: { value: number | null; status: "ok" | "unavailable" };
  steps: StepApy[];
  collateralToken?: `0x${string}`;
  borrowMarketKey?: `0x${string}`;
  snapshot?: StrategySnapshot;
};

export type DepositLeg = {
  protocol: string;
  bps: number;
  apy: number | null;
  status: "ok" | "unavailable";
};

export type DepositApy = {
  status: "ok" | "partial" | "unavailable";
  netApy: number | null;
  legs: DepositLeg[];
};
