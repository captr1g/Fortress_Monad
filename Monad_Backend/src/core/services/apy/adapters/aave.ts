import type { Address, PublicClient } from "viem";
import type { ApyAdapter, Market, MarketRates } from "../types.js";
import { rayToApy } from "../math.js";

const POOL_ABI = [
  {
    name: "getReserveData",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [
      {
        name: "data",
        type: "tuple",
        components: [
          { name: "configuration", type: "uint256" },
          { name: "liquidityIndex", type: "uint128" },
          { name: "currentLiquidityRate", type: "uint128" },
          { name: "variableBorrowIndex", type: "uint128" },
          { name: "currentVariableBorrowRate", type: "uint128" },
          { name: "currentStableBorrowRate", type: "uint128" },
          { name: "lastUpdateTimestamp", type: "uint40" },
          { name: "id", type: "uint16" },
          { name: "aTokenAddress", type: "address" },
          { name: "stableDebtTokenAddress", type: "address" },
          { name: "variableDebtTokenAddress", type: "address" },
          { name: "interestRateStrategyAddress", type: "address" },
          { name: "accruedToTreasury", type: "uint128" },
          { name: "unbacked", type: "uint128" },
          { name: "isolationModeTotalDebt", type: "uint128" },
        ],
      },
    ],
  },
] as const;

export class AaveAdapter implements ApyAdapter {
  readonly protocol = "aave" as const;

  constructor(
    private readonly getClient: (chainId: number) => PublicClient,
    private readonly poolAddresses: Record<number, Address>,
  ) { }

  supportsChain(chainId: number): boolean {
    return this.poolAddresses[chainId] !== undefined;
  }

  async getRatesBatch(
    markets: Market[],
    chainId: number,
  ): Promise<Map<string, MarketRates>> {
    const poolAddress = this.poolAddresses[chainId];
    if (!poolAddress) {
      throw new Error(`No Aave pool configured for chain ${chainId}`);
    }

    const client = this.getClient(chainId);
    const contracts = markets.map((m) => ({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: "getReserveData" as const,
      args: [m.reserveAddress as Address],
    }));

    const results = await client.multicall({ contracts, allowFailure: true });
    const ratesMap = new Map<string, MarketRates>();

    for (let i = 0; i < markets.length; i++) {
      const result = results[i];
      if (result.status === "failure") continue;

      const data = result.result as unknown as {
        currentLiquidityRate: bigint;
        currentVariableBorrowRate: bigint;
      };

      ratesMap.set(markets[i].marketId, {
        supplyApy: rayToApy(data.currentLiquidityRate),
        borrowApy: rayToApy(data.currentVariableBorrowRate),
        rewardsApy: null,
      });
    }

    return ratesMap;
  }
}
