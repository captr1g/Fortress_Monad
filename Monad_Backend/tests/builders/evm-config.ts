// Builds an EvmChainConfig for compiler/kernel unit tests. Uses synthetic but
// well-formed addresses so tests stay deterministic and independent of .env.
// (Real addresses are exercised in the integration tier.)
import type { EvmChainConfig } from "@chains/evm/types.js";
import { CONTRACTS, TOKENS } from "../datasets/base.js";

// Distinct, valid 20-byte addresses for each symbolic slot the compiler resolves.
const A = (n: number): `0x${string}` =>
  `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`;

export function makeEvmChainConfig(
  o: Partial<EvmChainConfig> = {},
): EvmChainConfig {
  return {
    vault: A(1),
    crossChainRouter: A(2),
    usdc: TOKENS.USDC,
    lifiDiamond: CONTRACTS.LIFI_DIAMOND,
    strategyExecutor: A(3),
    morphoExitExecutor: A(4),
    morphoLeverageExecutor: A(5),
    morphoBlue: CONTRACTS.MORPHO_BLUE,
    morphoAdapter: A(6),
    swapAdapter: A(7),
    pendleRouter: CONTRACTS.PENDLE_ROUTER,
    pendleAdapter: A(8),
    chainId: 8453,
    chainKey: "base",
    rpcUrl: "https://test.base.org",
    lifiApiKey: "",
    protocols: [],
    ...o,
  };
}
