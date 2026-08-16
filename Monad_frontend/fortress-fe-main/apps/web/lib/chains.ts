export const BASE_CHAIN_ID = 8453;
export const MONAD_CHAIN_ID = 143;
export const MONAD_TESTNET_CHAIN_ID = 10143;

export const CHAIN_EXPLORERS: Record<number, string> = {
  [BASE_CHAIN_ID]: "https://basescan.org",
  [MONAD_CHAIN_ID]: "https://explorer.monad.xyz",
  [MONAD_TESTNET_CHAIN_ID]: "https://testnet.explorer.monad.xyz",
};

export function getExplorerUrl(chainId: number, hash: string): string {
  const base = CHAIN_EXPLORERS[chainId] ?? "https://basescan.org";
  return `${base}/tx/${hash}`;
}

export function chainIdToNetwork(chainId?: number): string {
  if (chainId === BASE_CHAIN_ID) return "base";
  if (chainId === MONAD_CHAIN_ID || chainId === MONAD_TESTNET_CHAIN_ID) return "monad";
  if (chainId === 1) return "mainnet";
  return "monad";
}
