import { createPublicClient, http, keccak256, toBytes, type Address, type Chain } from "viem";
import { base, mainnet, arbitrum } from "viem/chains";
import type { EvmChainConfig } from "../types.js";

const VAULT_PROTOCOLS_ABI = [
  {
    name: "protocols",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "key", type: "bytes32" }],
    outputs: [
      { name: "addr", type: "address" },
      { name: "isERC4626", type: "bool" },
    ],
  },
] as const;

const CHAIN_BY_ID: Record<number, Chain> = {
  8453: base,
  1: mainnet,
  42161: arbitrum,
};

export type ProtocolMismatch = {
  protocol: string;
  configAddress: string;
  onChainAddress: string;
  onChainIsERC4626: boolean;
  configIsERC4626: boolean;
};

export type InvariantResult = {
  ok: boolean;
  chainKey: string;
  chainId: number;
  skipped: boolean;
  mismatches: ProtocolMismatch[];
};

/** Verifies backend protocol addresses match the on-chain vault registry. Skips gracefully for chains without a vault. */
export async function verifyProtocolInvariants(
  config: EvmChainConfig,
): Promise<InvariantResult> {
  const result: InvariantResult = {
    ok: true,
    chainKey: config.chainKey ?? "unknown",
    chainId: config.chainId,
    skipped: false,
    mismatches: [],
  };

  if (
    !config.vault ||
    config.vault === ("0x0000000000000000000000000000000000000000" as Address) ||
    !config.rpcUrl ||
    !config.protocols?.length
  ) {
    result.skipped = true;
    return result;
  }

  const chain = CHAIN_BY_ID[config.chainId] ?? base;
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

  for (const protocol of config.protocols) {
    if (!protocol.address || protocol.address === "0x0000000000000000000000000000000000000000") {
      continue;
    }

    const key = keccak256(toBytes(protocol.name));

    try {
      const [onChainAddr, onChainIsERC4626] = await client.readContract({
        address: config.vault,
        abi: VAULT_PROTOCOLS_ABI,
        functionName: "protocols",
        args: [key],
      });

      if (onChainAddr === "0x0000000000000000000000000000000000000000") continue;

      if (protocol.address.toLowerCase() !== onChainAddr.toLowerCase()) {
        result.mismatches.push({
          protocol: protocol.name,
          configAddress: protocol.address,
          onChainAddress: onChainAddr,
          onChainIsERC4626,
          configIsERC4626: protocol.isERC4626,
        });
      }

      if (onChainIsERC4626 !== protocol.isERC4626) {
        result.mismatches.push({
          protocol: `${protocol.name} (isERC4626 flag)`,
          configAddress: protocol.address,
          onChainAddress: onChainAddr,
          onChainIsERC4626,
          configIsERC4626: protocol.isERC4626,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[invariant:${result.chainKey}] RPC read failed for "${protocol.name}": ${msg}`);
    }
  }

  result.ok = result.mismatches.length === 0;
  return result;
}

/** Run invariant checks across multiple chain configs. */
export async function verifyAllChainInvariants(
  configs: EvmChainConfig[],
): Promise<InvariantResult[]> {
  return Promise.all(configs.map(verifyProtocolInvariants));
}
