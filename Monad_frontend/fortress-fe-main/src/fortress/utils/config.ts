import { keccak256, toBytes } from "viem";

// protocol name, key, isERC4626
export type ProtocolEntry = {
  name: string;
  key: `0x${string}`;
  isERC4626: boolean;
};

// Fortress Config stating all the address, chain, protocols
export type FortressConfig = {
  vault: `0x${string}`;
  crossChainRouter: `0x${string}`;
  usdc: `0x${string}`;
  lifiDiamond: `0x${string}`;
  strategyExecutor: `0x${string}`;
  morphoBlue: `0x${string}`;
  morphoAdapter: `0x${string}`;
  swapAdapter: `0x${string}`;
  chainId: number;
  rpcUrl: string;
  protocols: ProtocolEntry[];
};

function protocolKey(name: string): `0x${string}` {
  return keccak256(toBytes(name));
}

export function loadFortressConfig(): FortressConfig {
  const vault = (process.env.FORTRESS_VAULT ) as `0x${string}`;
  const crossChainRouter = (process.env.FORTRESS_CROSS_CHAIN_ROUTER ) as `0x${string}`;
  const usdc = (process.env.FORTRESS_USDC ) as `0x${string}`;
  const lifiDiamond = (process.env.FORTRESS_LIFI_DIAMOND ) as `0x${string}`;
  const strategyExecutor = (process.env.FORTRESS_STRATEGY_EXECUTOR ) as `0x${string}`;
  const morphoBlue = (process.env.FORTRESS_MORPHO_BLUE ) as `0x${string}`;
  const morphoAdapter = (process.env.FORTRESS_MORPHO_ADAPTER ) as `0x${string}`;
  const swapAdapter = (process.env.FORTRESS_SWAP_ADAPTER ) as `0x${string}`;
  const chainId = Number(process.env.FORTRESS_CHAIN_ID );
  const rpcUrl = (process.env.RPC_BASE) as `0x${string}`;

  // Protocols registered on-chain via registerProtocol(name, addr, isERC4626)
  // Add new entries here when owner registers more protocols
  const protocols: ProtocolEntry[] = [
    { name: "Morpho", key: protocolKey("Morpho"), isERC4626: true },
  ];

  return { vault, crossChainRouter, usdc, lifiDiamond, strategyExecutor, morphoBlue, morphoAdapter, swapAdapter, chainId, rpcUrl, protocols };
}
