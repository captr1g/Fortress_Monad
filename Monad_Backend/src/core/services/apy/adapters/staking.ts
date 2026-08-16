import type { ApyAdapter, Market, MarketRates } from "../types.js";

const DEFILLAMA_CHART = "https://yields.llama.fi/chart";
const TIMEOUT_MS = 10_000;

// Monad LST token address (lowercase) → DefiLlama pool uuid for its native
// staking yield.
//
// Empty on purpose. The Base entries this replaced were four verified uuids;
// no equivalent has been confirmed for any Monad LST (shMON included), and a
// guessed uuid would make the adapter report a *wrong* rate rather than an
// absent one — getRatesBatch below already treats "not in this map" as "no
// data", which is the honest outcome. Add an entry only once its uuid has been
// checked against the live DefiLlama chart endpoint.
const POOL_BY_TOKEN: Record<string, string> = {};

// Tokens with no native yield as Morpho collateral (plain wrapped assets /
// stables). Their collateral yield is a known 0, not missing data.
// Addresses verified live on Monad mainnet — see ADDRESSES.md §2.
const ZERO_YIELD_TOKENS = new Set<string>([
  "0x754704bc059f8c67012fed69bc8a327a5aafb603", // USDC
  "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242", // WETH
  "0x0555e30da8f98308edb960aa94c0db47230d2b9c", // WBTC
  "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b", // cbBTC
  "0xe7cd86e13ac4309349f30b3435a9d337750fc82d", // USDT0
  "0x00000000efe302beaa2b3e6e1b18d08d69a9012a", // AUSD
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a", // WMON
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
