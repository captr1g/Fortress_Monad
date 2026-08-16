import { createPublicClient, http, keccak256, encodeAbiParameters, type Address } from "viem";
import { base } from "viem/chains";
import type {
  MorphoMarketParams,
  MorphoInOut,
  ExistingMarketPosition,
} from "@domains/yield/types/market.js";
import { morphoBlueAbi, marketParamsAbiType } from "../../config/base_abi.js";
import {
  fetchOraclePrice,
  ORACLE_PRICE_SCALE,
  WAD,
} from "../../execution/pricing.js";
import type { PositionView } from "@domains/yield/types/exit.js";
import type { Intent } from "@domains/yield/types/intent.js";
import { VIRTUAL_ASSETS, VIRTUAL_SHARES } from "@domains/yield/types/market.js";

/**
 * Morpho market id = keccak256(abi.encode(MarketParams)), matching the on-chain
 * `_marketId` used by MorphoStrategyAdapter.
 */
export function computeMarketId(market: MorphoMarketParams): Address {
  return keccak256(
    encodeAbiParameters(marketParamsAbiType, [
      {
        loanToken: market.loanToken,
        collateralToken: market.collateralToken,
        oracle: market.oracle,
        irm: market.irm,
        lltv: market.lltv,
      },
    ]),
  );
}

/**
 * Reads the user's existing collateral and debt for a Morpho market on-chain.
 * Debt is converted from borrow shares to assets, rounding UP against the borrower
 * exactly as both Morpho and the on-chain adapter do, so the off-chain borrow
 * ceiling is sized against the same base the adapter will use at execution.
 *
 * Returns a zeroed position if the read fails, so a flaky RPC never blocks a plan
 * (the on-chain adapter remains the authoritative sizing/guard).
 */
export async function fetchExistingPosition(
  rpcUrl: string,
  morphoBlue: Address,
  market: MorphoMarketParams,
  user: Address,
): Promise<ExistingMarketPosition> {
  try {
    const client = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const id = computeMarketId(market);

    const [, borrowShares, collateral] = (await client.readContract({
      address: morphoBlue,
      abi: morphoBlueAbi,
      functionName: "position",
      args: [id, user],
    })) as readonly [bigint, bigint, bigint];

    if (borrowShares === 0n) {
      return { collateral, debt: 0n };
    }

    const [, , totalBorrowAssets, totalBorrowShares] =
      (await client.readContract({
        address: morphoBlue,
        abi: morphoBlueAbi,
        functionName: "market",
        args: [id],
      })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];

    // assets = ceil(shares * (totalBorrowAssets + VIRTUAL_ASSETS) / (totalBorrowShares + VIRTUAL_SHARES))
    const numerator = borrowShares * (totalBorrowAssets + VIRTUAL_ASSETS);
    const denominator = totalBorrowShares + VIRTUAL_SHARES;
    const debt =
      denominator === 0n ? 0n : (numerator + denominator - 1n) / denominator;

    return { collateral, debt };
  } catch {
    return { collateral: 0n, debt: 0n };
  }
}

/**
 * Reads the user's full position for a market and enriches it with the live oracle
 * price: collateral value (loan-token units), exact interest-accrued debt, and LTV.
 * The debt read uses the same round-up share->asset conversion as the on-chain
 * adapter, so off-chain numbers match what the contract sizes against.
 */
export async function readPosition(
  rpcUrl: string,
  morphoBlue: Address,
  market: MorphoMarketParams,
  marketKey: string,
  user: Address,
): Promise<PositionView> {
  const { collateral, debt } = await fetchExistingPosition(
    rpcUrl,
    morphoBlue,
    market,
    user,
  );
  const price = await fetchOraclePrice(rpcUrl, market.oracle);
  const collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
  const ltv =
    collateralValue === 0n
      ? 0
      : Number((debt * WAD) / collateralValue) / Number(WAD);

  return {
    market: marketKey,
    collateralToken: market.collateralToken,
    loanToken: market.loanToken,
    collateral,
    debt,
    collateralValue,
    ltv,
    lltv: Number(market.lltv) / Number(WAD),
  };
}

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
    let collateralToken: Address | undefined;
    let loanToken: Address | undefined;

    for (const step of intent.steps) {
      if (step.action === "supplyCollateral" && !collateralToken) {
        collateralToken = step.tokenIn as Address;
      }
      if (step.action === "borrow" && !loanToken) {
        loanToken = step.tokenIn as Address;
      }
    }

    // Single-asset loops may not have an explicit borrow token yet so use input token as the loan token
    loanToken ??= intent.inputToken as Address;
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
    collateralToken: Address,
    loanToken: Address,
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
    const zeroAddr = "0x0000000000000000000000000000000000000000" as Address;
    return {
      loanToken: (market.loanAsset?.address ?? zeroAddr) as Address,
      collateralToken: (market.collateralAsset?.address ?? zeroAddr) as Address,
      oracle: (market.oracle?.address ?? zeroAddr) as Address,
      irm: (market.irmAddress ?? zeroAddr) as Address,
      lltv: market.lltv ? BigInt(market.lltv) : 0n,
    };
  }
}
