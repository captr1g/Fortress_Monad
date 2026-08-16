import { type Address, createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { morphoBlueAbi, morphoOracleAbi } from "@chains/evm/config/abi.js";
import { computeMarketId } from "@chains/evm/protocols/morpho/morpho.service.js";
import { ORACLE_PRICE_SCALE, WAD } from "@chains/evm/execution/pricing.js";
import type { DiscoveredMarket, StoredPosition } from "./types.js";

const VIRTUAL_SHARES = 1_000_000n;
const VIRTUAL_ASSETS = 1n;

// Reads many positions in batched multicalls (one RPC round per call type) instead of
// per-position requests. Debt uses the same round-up share->asset conversion as the
// on-chain adapter so the figures match what the contract sizes against.
export async function readPositionsBatch(
  rpcUrl: string,
  morphoBlue: Address,
  wallet: Address,
  markets: DiscoveredMarket[],
): Promise<Omit<StoredPosition, "netApy" | "updatedAt">[]> {
  if (markets.length === 0) return [];

  const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
  const ids = markets.map((m) => computeMarketId(m.params));

  const positionCalls = ids.map((id) => ({
    address: morphoBlue,
    abi: morphoBlueAbi,
    functionName: "position" as const,
    args: [id, wallet] as const,
  }));
  const marketCalls = ids.map((id) => ({
    address: morphoBlue,
    abi: morphoBlueAbi,
    functionName: "market" as const,
    args: [id] as const,
  }));
  const priceCalls = markets.map((m) => ({
    address: m.params.oracle,
    abi: morphoOracleAbi,
    functionName: "price" as const,
  }));

  const [positions, marketStates, prices] = await Promise.all([
    client.multicall({ contracts: positionCalls }),
    client.multicall({ contracts: marketCalls }),
    client.multicall({ contracts: priceCalls }),
  ]);

  const out: Omit<StoredPosition, "netApy" | "updatedAt">[] = [];
  for (let i = 0; i < markets.length; i++) {
    const pos = positions[i];
    const mkt = marketStates[i];
    const price = prices[i];
    if (
      pos.status !== "success" ||
      mkt.status !== "success" ||
      price.status !== "success"
    ) {
      continue;
    }

    const [, borrowShares, collateral] = pos.result as readonly [
      bigint,
      bigint,
      bigint,
    ];
    const [, , totalBorrowAssets, totalBorrowShares] = mkt.result as readonly [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    const oraclePrice = price.result as bigint;

    let debt = 0n;
    if (borrowShares > 0n) {
      const numerator = borrowShares * (totalBorrowAssets + VIRTUAL_ASSETS);
      const denominator = totalBorrowShares + VIRTUAL_SHARES;
      debt =
        denominator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
    }

    const collateralValue = (collateral * oraclePrice) / ORACLE_PRICE_SCALE;
    const ltv =
      collateralValue === 0n
        ? 0
        : Number((debt * WAD) / collateralValue) / Number(WAD);

    out.push({
      wallet,
      marketKey: markets[i].marketKey,
      collateralToken: markets[i].params.collateralToken,
      loanToken: markets[i].params.loanToken,
      oracle: markets[i].params.oracle,
      irm: markets[i].params.irm,
      lltvWad: markets[i].params.lltv.toString(),
      collateral: collateral.toString(),
      debt: debt.toString(),
      collateralValue: collateralValue.toString(),
      ltv,
      lltv: Number(markets[i].params.lltv) / Number(WAD),
    });
  }

  return out;
}
