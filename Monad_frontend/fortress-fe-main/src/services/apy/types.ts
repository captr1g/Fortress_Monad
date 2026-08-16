export type Protocol = "aave" | "morpho";

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
  getRatesBatch(markets: Market[], chainId: number): Promise<Map<string, MarketRates>>;
}
