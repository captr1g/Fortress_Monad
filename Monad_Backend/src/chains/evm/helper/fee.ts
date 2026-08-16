// Fee helpers for the FeeModule-enabled contracts (FortStrategyExecutor,
// MorphoLeverageExecutor, CrossChainRouter).
//
// These contracts skim `feeBps` from the INPUT amount up front and forward only
// the NET amount to the underlying operation. Any calldata the backend pre-builds
// off an exact amount (LiFi bridge routes, flash-loan entry swaps, first-step
// strategy swaps) must therefore be sized off the NET input — otherwise the
// baked-in amount exceeds what the contract actually approves and the swap/bridge
// reverts. The gross amount is still passed as the function argument, since the
// contract pulls gross from the user before skimming.

import { createPublicClient, http, type Address } from "viem";
import { monad } from "viem/chains";
import { feeModuleAbi } from "../config/abi.js";

const BPS = 10000n;

/// Reads the current `feeBps` from a FeeModule contract.
/// Throws (fail-hard) if the read fails: the fee directly determines the net
/// amount every downstream calldata (LiFi route, flash-swap size, entry-swap
/// amount) is built against. Silently assuming 0 here would bake an amount that
/// exceeds the contract's post-fee approval and revert on-chain — a confusing
/// "signed then reverted" UX. Failing at build time surfaces a clean error
/// before the user ever signs, and these builds already depend on several other
/// live reads, so one more required read adds no meaningful fragility.
export async function readFeeBps(
  rpcUrl: string,
  contract: Address,
): Promise<bigint> {
  try {
    const client = createPublicClient({ chain: monad, transport: http(rpcUrl) });
    const fee = (await client.readContract({
      address: contract,
      abi: feeModuleAbi,
      functionName: "feeBps",
    })) as number;
    return BigInt(fee);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read feeBps from ${contract}: ${msg}`);
  }
}

/// Returns the net amount left after skimming `feeBps` from `gross`, mirroring the
/// on-chain `_collectFee` arithmetic exactly (floor division on the fee).
export function netAfterFee(gross: bigint, feeBps: bigint): bigint {
  if (feeBps === 0n) return gross;
  const fee = (gross * feeBps) / BPS;
  return gross - fee;
}
