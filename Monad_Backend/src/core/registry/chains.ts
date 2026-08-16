// Register chains in boot.ts
import type { ChainInfo, TokenInfo } from "./types.js";

const CHAIN_REGISTRY: Map<string, ChainInfo> = new Map();

export function registerChain(chain: ChainInfo): void {
  CHAIN_REGISTRY.set(chain.chainKey, chain);
}

export function getChainByKey(chainKey: string): ChainInfo | undefined {
  return CHAIN_REGISTRY.get(chainKey);
}

export function getChainById(chainId: number): ChainInfo | undefined {
  for (const chain of CHAIN_REGISTRY.values()) {
    if (chain.chainId === chainId) return chain;
  }
  return undefined;
}

export function getChain(chainId: number): ChainInfo | undefined {
  return getChainById(chainId);
}

export function listChains(): ChainInfo[] {
  return [...CHAIN_REGISTRY.values()];
}

export function findToken(
  chainKey: string,
  symbolOrAddress: string,
): TokenInfo | undefined {
  const chain = CHAIN_REGISTRY.get(chainKey);
  if (!chain) return undefined;
  const lower = symbolOrAddress.toLowerCase();
  return chain.tokens.find(
    (t) =>
      t.symbol.toLowerCase() === lower || t.address.toLowerCase() === lower,
  );
}

export function findTokenById(
  chainId: number,
  symbolOrAddress: string,
): TokenInfo | undefined {
  const chain = getChainById(chainId);
  if (!chain) return undefined;
  const lower = symbolOrAddress.toLowerCase();
  return chain.tokens.find(
    (t) =>
      t.symbol.toLowerCase() === lower || t.address.toLowerCase() === lower,
  );
}

export function tokenAddress(
  chainId: number,
  symbol: string,
): `0x${string}` | undefined {
  return findTokenById(chainId, symbol)?.address;
}
