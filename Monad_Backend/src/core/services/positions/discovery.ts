import { Address } from "viem";
import type { DiscoveredMarket } from "./types.js";

const MORPHO_GRAPHQL = "https://blue-api.morpho.org/graphql";
const TIMEOUT_MS = 10_000;

type GqlMarket = {
  marketId: string;
  loanAsset: { address: string };
  collateralAsset: { address: string };
  oracleAddress: string;
  irmAddress: string;
  lltv: string;
};

type GqlMarketPosition = {
  market: GqlMarket;
  state: { collateral: number | string; borrowShares: number | string } | null;
};

// Discovers every market where the wallet holds an active leverage position
// (non-zero collateral and borrow) via Morpho's userByAddress GraphQL.
export async function discoverWalletMarkets(
  wallet: string,
  chainId: number,
): Promise<DiscoveredMarket[]> {
  const query = `
    query ($address: String!, $chainId: Int!) {
      userByAddress(address: $address, chainId: $chainId) {
        marketPositions {
          market {
            marketId
            loanAsset { address }
            collateralAsset { address }
            oracleAddress
            irmAddress
            lltv
          }
          state { collateral borrowShares }
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
      body: JSON.stringify({ query, variables: { address: wallet, chainId } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Morpho GraphQL returned ${res.status}`);

    const json = (await res.json()) as {
      data?: { userByAddress?: { marketPositions?: GqlMarketPosition[] } };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length)
      throw new Error(`Morpho GraphQL: ${json.errors[0].message}`);

    const positions = json.data?.userByAddress?.marketPositions ?? [];
    const out: DiscoveredMarket[] = [];

    for (const p of positions) {
      const collateral = BigInt(p.state?.collateral ?? 0);
      const borrowShares = BigInt(p.state?.borrowShares ?? 0);
      if (collateral === 0n || borrowShares === 0n) continue;

      out.push({
        marketKey: p.market.marketId as Address,
        params: {
          loanToken: p.market.loanAsset.address as Address,
          collateralToken: p.market.collateralAsset.address as Address,
          oracle: p.market.oracleAddress as Address,
          irm: p.market.irmAddress as Address,
          lltv: BigInt(p.market.lltv),
        },
      });
    }

    return out;
  } finally {
    clearTimeout(timeout);
  }
}
