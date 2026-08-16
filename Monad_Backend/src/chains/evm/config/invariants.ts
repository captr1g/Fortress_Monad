import { createPublicClient, http, keccak256, toBytes, type Address, type Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";
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
  143: monad,
  10143: monadTestnet,
};

/**
 * Fails the boot when the configured chain isn't the chain the RPC actually
 * serves, or when a configured address has no contract on it.
 *
 * verifyProtocolInvariants below can't catch this: it only reads the vault's
 * own registry, so a config that mixes a correct vault with another chain's
 * token addresses and another chain's `chainId` passes it cleanly. That exact
 * mix shipped a transaction that approved Base USDC (no code on Monad) and
 * carried chainId 8453, which the user's Monad-connected wallet rejected with
 * "Chain ID must match the dApp selected network: Got 0x2105, expected 0x8f".
 *
 * Every check here is a question put to the chain, not an assumption:
 * eth_chainId for identity, eth_getCode for existence.
 */
export type ChainIdentityResult = {
  ok: boolean;
  skipped: boolean;
  errors: string[];
};

export async function verifyChainIdentity(
  config: EvmChainConfig,
): Promise<ChainIdentityResult> {
  const errors: string[] = [];
  if (!config.rpcUrl) return { ok: true, skipped: true, errors };

  const chain = CHAIN_BY_ID[config.chainId] ?? monad;
  const client = createPublicClient({ chain, transport: http(config.rpcUrl) });

  let liveChainId: number;
  try {
    liveChainId = await client.getChainId();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      skipped: false,
      errors: [`RPC ${config.rpcUrl} is unreachable: ${msg}`],
    };
  }

  if (liveChainId !== config.chainId) {
    errors.push(
      `FORTRESS_CHAIN_ID is ${config.chainId}, but ${config.rpcUrl} reports ` +
      `chain ${liveChainId}. Every transaction would be built for the wrong ` +
      `chain and rejected by the user's wallet. Set FORTRESS_CHAIN_ID=${liveChainId}.`,
    );
  }

  // A configured address with no bytecode is almost always another chain's
  // address left behind in .env — the single most common way this breaks.
  const required: [string, Address | undefined, string][] = [
    ["FORTRESS_USDC", config.usdc, "the loan token every deposit approves"],
    ["FORTRESS_VAULT", config.vault, "FortVault"],
    ["FORTRESS_LIFI_DIAMOND", config.lifiDiamond, "the LI.FI diamond swaps route through"],
    ["FORTRESS_MORPHO_BLUE", config.morphoBlue, "Morpho Blue"],
  ];

  const ZERO = "0x0000000000000000000000000000000000000000";
  await Promise.all(
    required.map(async ([envVar, address, what]) => {
      if (!address || address === ZERO) return; // unset is a deliberate opt-out
      try {
        const code = await client.getCode({ address });
        if (!code || code === "0x") {
          errors.push(
            `${envVar}=${address} has no contract on chain ${liveChainId} ` +
            `(${what}). This is another chain's address.`,
          );
        }
      } catch {
        // A failed read is not proof of absence — don't fail the boot on it.
      }
    }),
  );

  return { ok: errors.length === 0, skipped: false, errors };
}

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

  const chain = CHAIN_BY_ID[config.chainId] ?? monad;
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
