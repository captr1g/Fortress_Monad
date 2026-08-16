import type { MorphoMarketParams, MorphoInOut } from "../helpers/strategy-builder.js";
import type { Intent } from "../types/intent.js";

export type MorphoMarketItem = {
    loanAsset: { address: string };
    collateralAsset: { address: string };
    oracle: { address: string };
    irmAddress: string;
    lltv: string;
    state?: { supplyAssetsUsd?: number };
};

export class MorphoMarketService {
    private readonly chainId: number;

    constructor(chainId: number) {
        this.chainId = chainId;
    }

    /**
     * Resolves a Morpho market reference to its on-chain params. Accepts either:
     *  - a bytes32 uniqueKey (looked up directly), or
     *  - a human label like "cbBTC-USDC" (resolved by inferring the collateral
     *    and loan tokens from the strategy steps and matching the most liquid
     *    market whose LLTV safely exceeds the target LTV).
     */
    async resolveMorphoMarket(
        marketId: string,
        intent: Extract<Intent, { action: "strategy" }>,
        targetLtv?: number,
    ): Promise<MorphoMarketParams | null> {
        if (/^0x[a-fA-F0-9]{64}$/.test(marketId)) {
            return this.fetchMarketByUniqueKey(marketId);
        }

        const pair = this.inferMarketTokens(intent);
        if (!pair) return null;
        return this.fetchMarketByPair(
            pair.collateralToken,
            pair.loanToken,
            targetLtv,
        );
    }

    /**
     * Infers the (collateralToken, loanToken) pair from the strategy steps:
     * the collateral is what gets supplied, the loan token is what gets borrowed.
     * Falls back to the input token as the loan token for single-asset loops.
     */
    inferMarketTokens(
        intent: Extract<Intent, { action: "strategy" }>,
    ): MorphoInOut | null {
        let collateralToken: `0x${string}` | undefined;
        let loanToken: `0x${string}` | undefined;

        for (const step of intent.steps) {
            if (step.action === "supplyCollateral" && !collateralToken) {
                collateralToken = step.tokenIn as `0x${string}`;
            }
            if (step.action === "borrow" && !loanToken) {
                loanToken = step.tokenIn as `0x${string}`;
            }
        }

        // Single-asset loops may not have an explicit borrow token yet so use input token as the loan token
        loanToken ??= intent.inputToken as `0x${string}`;
        if (!collateralToken) return null;

        return { collateralToken, loanToken };
    }

    // Fetch a Morpho market by its uniqueKey (bytes32) from the Morpho GraphQL API. Returns null if not found or if the query fails.
    async fetchMarketByUniqueKey(
        uniqueKey: string,
    ): Promise<MorphoMarketParams | null> {
        const query = `
      query GetMarket($uniqueKeys: [String!]!, $chainIds: [Int!]!) {
        markets(where: { uniqueKey_in: $uniqueKeys, chainId_in: $chainIds }) {
          items {
            loanAsset { address }
            collateralAsset { address }
            oracle { address }
            irmAddress
            lltv
          }
        }
      }
    `;
        const items = await this.queryMorphoMarkets(query, {
            uniqueKeys: [uniqueKey],
            chainIds: [this.chainId],
        });
        const market = items[0];
        return market ? this.toMarketParams(market) : null;
    }

    // Fetch a Morpho market by its collateral/loan token pair from the Morpho GraphQL API. Returns null if not found or if the query fails.
    async fetchMarketByPair(
        collateralToken: `0x${string}`,
        loanToken: `0x${string}`,
        targetLtv?: number,
    ): Promise<MorphoMarketParams | null> {
        const query = `
      query GetMarketsByPair($collateral: [String!]!, $loan: [String!]!, $chainIds: [Int!]!) {
        markets(where: {
          collateralAssetAddress_in: $collateral,
          loanAssetAddress_in: $loan,
          chainId_in: $chainIds
        }) {
          items {
            loanAsset { address }
            collateralAsset { address }
            oracle { address }
            irmAddress
            lltv
            state { supplyAssetsUsd }
          }
        }
      }
    `;
        const items = await this.queryMorphoMarkets(query, {
            collateral: [collateralToken],
            loan: [loanToken],
            chainIds: [this.chainId],
        });
        if (items.length === 0) return null;

        // Filter markets by LLTV >= targetLtv + 2% buffer, then sort by supplyAssetsUsd descending to pick the most liquid market.
        const minLltv = targetLtv
            ? BigInt(Math.floor((targetLtv + 0.02) * 1e18))
            : 0n;

        const eligible = items
            .filter((m) => BigInt(m.lltv) >= minLltv)
            .sort(
                (a, b) =>
                    (b.state?.supplyAssetsUsd ?? 0) - (a.state?.supplyAssetsUsd ?? 0),
            );

        const chosen = eligible[0] ?? null;
        return chosen ? this.toMarketParams(chosen) : null;
    }

    // Query the Morpho GraphQL API for markets with a timeout and graceful error handling.
    private async queryMorphoMarkets(
        query: string,
        variables: Record<string, unknown>,
    ): Promise<MorphoMarketItem[]> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            const res = await fetch("https://blue-api.morpho.org/graphql", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, variables }),
                signal: controller.signal,
            });
            if (!res.ok) return [];
            const json = (await res.json()) as {
                data?: { markets?: { items?: MorphoMarketItem[] } };
            };
            return json.data?.markets?.items ?? [];
        } catch {
            return [];
        } finally {
            clearTimeout(timeout);
        }
    }

    // Convert a MorphoMarketItem from the GraphQL API into MorphoMarketParams for internal use.
    private toMarketParams(market: MorphoMarketItem): MorphoMarketParams {
        return {
            loanToken: market.loanAsset.address as `0x${string}`,
            collateralToken: market.collateralAsset.address as `0x${string}`,
            oracle: market.oracle.address as `0x${string}`,
            irm: market.irmAddress as `0x${string}`,
            lltv: BigInt(market.lltv),
        };
    }
}
