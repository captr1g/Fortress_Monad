import type { ApyAdapter, Market, MarketRates } from "../types.js";

const MORPHO_GRAPHQL = "https://api.morpho.org/graphql";
const TIMEOUT_MS = 10_000;

type MorphoMarketState = {
  marketId: string;
  state: {
    supplyApy: number;
    borrowApy: number;
    rewards: Array<{ supplyApr: number; borrowApr: number }>;
  };
};

export class MorphoAdapter implements ApyAdapter {
  readonly protocol = "morpho" as const;

  async getRatesBatch(markets: Market[], chainId: number): Promise<Map<string, MarketRates>> {
    const keys = markets.map((m) => m.marketKey).filter(Boolean) as string[];
    if (keys.length === 0) return new Map();

    const query = `
      query ($keys: [String!]!, $chainIds: [Int!]!) {
        markets(where: { uniqueKey_in: $keys, chainId_in: $chainIds }) {
          items {
            marketId
            state { supplyApy borrowApy rewards { supplyApr borrowApr } }
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(MORPHO_GRAPHQL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { keys, chainIds: [chainId] } }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Morpho API returned ${res.status}`);
      }

      const json = (await res.json()) as {
        data?: { markets: { items: MorphoMarketState[] } };
        errors?: Array<{ message: string }>;
      };

      if (json.errors?.length) {
        throw new Error(`Morpho GraphQL: ${json.errors[0].message}`);
      }

      const items = json.data?.markets.items ?? [];
      const byKey = new Map<string, MorphoMarketState>();
      for (const item of items) {
        byKey.set(item.marketId, item);
      }

      const ratesMap = new Map<string, MarketRates>();
      for (const market of markets) {
        const item = byKey.get(market.marketKey!);
        if (!item) continue;

        const totalRewardsApr = item.state.rewards.reduce(
          (sum, r) => sum + r.supplyApr + r.borrowApr, 0
        );

        ratesMap.set(market.marketId, {
          supplyApy: item.state.supplyApy,
          borrowApy: item.state.borrowApy,
          rewardsApy: totalRewardsApr > 0 ? totalRewardsApr : null,
        });
      }

      return ratesMap;
    } finally {
      clearTimeout(timeout);
    }
  }
}
