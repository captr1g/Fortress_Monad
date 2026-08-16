import type { ApyAdapter, Market, MarketRates } from "../types.js";

const DEFILLAMA_CHART = "https://yields.llama.fi/chart";
const TIMEOUT_MS = 10_000;

// Base LST token address (lowercase) → DefiLlama pool uuid for its native staking yield.
const POOL_BY_TOKEN: Record<string, string> = {
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452":
    "747c1d2a-c668-4682-b9f9-296708a3dd90",
  "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a":
    "333f3e8b-6fe3-4ba0-9657-265ae94b7496",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22":
    "0f45d730-b279-4629-8e11-ccb5cc3038b4",
  "0x2416092f143378750bb29b79ed961ab195cceea5":
    "e28e32b5-e356-41d9-8dc7-a376ece56619",
};

// Tokens with no native yield as Morpho collateral (plain wrapped assets / stables).
// Their collateral yield is a known 0, not missing data.
const ZERO_YIELD_TOKENS = new Set<string>([
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
  "0x4200000000000000000000000000000000000006",
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
]);

type ChartPoint = {
  apyBase: number | null;
  apyReward: number | null;
};

async function fetchPoolRates(poolId: string): Promise<ChartPoint | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFILLAMA_CHART}/${poolId}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`DefiLlama API returned ${res.status}`);
    }
    const json = (await res.json()) as { status: string; data: ChartPoint[] };
    if (json.status !== "success" || json.data.length === 0) {
      throw new Error("DefiLlama API returned non-success status");
    }
    return json.data[json.data.length - 1];
  } finally {
    clearTimeout(timeout);
  }
}

export class StakingAdapter implements ApyAdapter {
  readonly protocol = "staking" as const;

  async getRatesBatch(markets: Market[]): Promise<Map<string, MarketRates>> {
    const ratesMap = new Map<string, MarketRates>();

    const lstMarkets: Market[] = [];
    for (const market of markets) {
      if (!market.reserveAddress) continue;
      const token = market.reserveAddress.toLowerCase();

      if (ZERO_YIELD_TOKENS.has(token)) {
        ratesMap.set(market.marketId, {
          supplyApy: 0,
          borrowApy: null,
          rewardsApy: null,
        });
        continue;
      }
      if (POOL_BY_TOKEN[token]) lstMarkets.push(market);
    }

    if (lstMarkets.length === 0) return ratesMap;

    await Promise.all(
      lstMarkets.map(async (market) => {
        const poolId = POOL_BY_TOKEN[market.reserveAddress!.toLowerCase()];
        const point = await fetchPoolRates(poolId);
        if (!point || point.apyBase === null) return;

        ratesMap.set(market.marketId, {
          supplyApy: point.apyBase / 100,
          borrowApy: null,
          rewardsApy: point.apyReward ? point.apyReward / 100 : null,
        });
      }),
    );

    return ratesMap;
  }
}
