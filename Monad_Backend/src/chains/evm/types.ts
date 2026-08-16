// EVM-specific types: protocol entries and chain configuration.
// Chain-agnostic types (TokenInfo, MarketInfo, ChainInfo) live in core/registry/chains.ts.

import type { StrategyApy } from "@core/services/apy/types";
import type { Address } from "viem";

export type ApySource =
  | "morpho-vault"
  | "aave-pool"
  | "compound-comet"
  | "defillama"
  | "pendle-implied"
  | "erc4626-onchain"
  | "aerodrome-gauge"
  | "none";

export type PendleVaultMarket = { label: string; market: Address };

export type AerodromePool = {
  label: string;         // e.g. "USDC-WETH"
  poolKey: Address;      // keccak256(bytes(label)) — must match on-chain adapter
  pool: Address;         // LP token address
  gauge: Address;        // Gauge (position token for this pool)
  pairedToken: Address;  // The non-USDC side of the pair
  stable: boolean;       // true = sAMM (stable), false = vAMM (volatile)
};

export type ProtocolEntry = {
  name: string;
  key: Address;
  isERC4626: boolean;
  address: Address;
  apySource: ApySource;
  displayName?: string;
  positionToken?: Address;
  defiLlamaPoolId?: string;
  /**
   * The actual vault/wrapper token symbol a deposit lands in on-chain (e.g.
   * "mwUSDC" for Morpho, which is really a Moonwell Flagship USDC vault) —
   * shown in the UI next to the protocol name so users always know exactly
   * which contract holds their funds, not just the umbrella brand name.
   */
  vaultSymbol?: string;
  /**
   * For `apySource: "aave-pool"` — the Pool this venue supplies into. Monad has
   * two Aave V3 markets (Aave V3 Monad and Neverland, a fork at an older
   * revision), so the pool cannot be a module-level constant the way it was
   * when Base had exactly one.
   */
  aavePool?: Address;
  pendleVaultMarkets?: PendleVaultMarket[];
  defaultPendleMarket?: Address;
  aerodromePools?: AerodromePool[];
  defaultAerodromePool?: string; // label of the default pool (e.g. "USDC-WETH")
  /**
   * Alternate names the planner or a user might reasonably use instead of
   * `name` — e.g. CompoundV3's registry name doesn't match how anyone
   * actually refers to the protocol in a sentence. Checked case-insensitively
   * alongside `name` by `resolveProtocolEntry`.
   */
  aliases?: string[];
};

/**
 * The one place that turns a protocol name (from a planner-generated intent
 * or user input) into its registry entry — case-insensitive, alias-aware.
 * Was previously duplicated ad-hoc in kernel.ts, vault-withdraw.ts, and
 * vault-builder.ts, each only matching `name` exactly and silently failing
 * on any protocol whose registry key doesn't match its common name (e.g.
 * "Compound" vs "CompoundV3").
 */
export function resolveProtocolEntry(
  protocols: ProtocolEntry[],
  name: string,
): ProtocolEntry | undefined {
  const needle = name.trim().toLowerCase();
  return protocols.find(
    (p) =>
      p.name.toLowerCase() === needle ||
      p.aliases?.some((a) => a.toLowerCase() === needle),
  );
}

export type EvmChainConfig = {
  vault: Address;
  swapRouter: Address;
  crossChainRouter: Address;
  usdc: Address;
  lifiDiamond: Address;
  strategyExecutor: Address;
  morphoExitExecutor: Address;
  morphoLeverageExecutor: Address;
  morphoBlue: Address;
  morphoAdapter: Address;
  swapAdapter: Address;
  pendleRouter: Address;
  pendleAdapter: Address;
  aerodromeRouter: Address;
  chainId: number;
  chainKey: string;
  rpcUrl: string;
  lifiApiKey: string;
  protocols: ProtocolEntry[];
};

//Tenderly simulation && Transaction calldata :-
export type TenderlyConfig = {
  accessKey: string;
  accountSlug: string;
  projectSlug: string;
  timeoutMs?: number;
};

export type EvmTransaction = {
  to: Address;
  data: Address;
  value: bigint;
  chainId: number;
};

export type EvmSimulationResult = {
  success: boolean;
  gasUsed: bigint;
  error?: string;
};

//Kernal:-
export type EvmKernelDeps = {
  chainConfig: EvmChainConfig;
  tenderly: TenderlyConfig;
};

// Vault build result uses EvmTransaction directly.
export type BuildResult = {
  transactions: EvmTransaction[];
  description: string;
  apy?: StrategyApy;
};


