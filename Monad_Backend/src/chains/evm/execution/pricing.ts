// Oracle pricing

import { Address, createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { morphoOracleAbi } from "../config/abi.js";

export const ORACLE_PRICE_SCALE = 10n ** 36n;
export const WAD = 10n ** 18n;

/**
 * Fetches the latest price from an oracle.
 *
 * @param rpcUrl  JSON-RPC endpoint
 * @param oracle  oracle address
 * @returns price scaled to 1e36
 */
export async function fetchOraclePrice(
  rpcUrl: string,
  oracle: Address,
): Promise<bigint> {
  const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
  const price = await client.readContract({
    address: oracle,
    abi: morphoOracleAbi,
    functionName: "price",
  });
  return price;
}

/**
 * Computes a defense-in-depth borrow ceiling (in loan-token units) for a single
 * loop iteration, sized from the collateral the swap is expected to produce.
 *
 * The contract sizes the actual borrow on-chain from real collateral; this ceiling
 * only caps how far a borrow may go if the live state ever disagrees with what the
 * user was shown. We pad it above the expected value so honest execution never trips
 * the cap, while a runaway/oracle-glitch borrow still cannot exceed it.
 *
 * @param expectedCollateral  collateral units expected to be supplied this iteration
 * @param oraclePrice         oracle price (1e36 scale)
 * @param targetLtvWad        target LTV in WAD (e.g. 0.8e18)
 * @param paddingBps          headroom above the expected borrow (e.g. 300 = +3%)
 */
export function computeBorrowCeiling(params: {
  expectedCollateral: bigint;
  oraclePrice: bigint;
  targetLtvWad: bigint;
  paddingBps?: number;
}): bigint {
  const { expectedCollateral, oraclePrice, targetLtvWad } = params;
  const paddingBps = BigInt(params.paddingBps ?? 300);

  // collateralValue = collateral × price / 1e36   (loan-token units)
  const collateralValue =
    (expectedCollateral * oraclePrice) / ORACLE_PRICE_SCALE;
  // targetDebt = collateralValue × targetLtv / 1e18
  const targetDebt = (collateralValue * targetLtvWad) / WAD;
  // ceiling = targetDebt × (1 + padding)
  return (targetDebt * (10000n + paddingBps)) / 10000n;
}

