// Monad is the only chain FORTRESS executes on. The backend registers exactly
// one executable chain (Monad_Backend/src/boot.ts) and rejects any plan whose
// input token isn't one of its tokens, so anything Base-shaped here produces a
// plan the backend refuses.

export const MONAD_CHAIN_ID = 143;
export const MONAD_TESTNET_CHAIN_ID = 10143;
export const DEFAULT_MONAD_CHAIN_ID = MONAD_CHAIN_ID;

// `explorer.monad.xyz` does not resolve (DNS failure). monadscan.com is live
// and is what viem's `monad` chain lists as its API-backed explorer.
export const CHAIN_EXPLORERS: Record<number, string> = {
  [MONAD_CHAIN_ID]: "https://monadscan.com",
  [MONAD_TESTNET_CHAIN_ID]: "https://testnet.monadexplorer.com",
};

export function getExplorerUrl(chainId: number, hash: string): string {
  const explorer = CHAIN_EXPLORERS[chainId] ?? CHAIN_EXPLORERS[MONAD_CHAIN_ID];
  return `${explorer}/tx/${hash}`;
}

export function getAddressUrl(chainId: number, address: string): string {
  const explorer = CHAIN_EXPLORERS[chainId] ?? CHAIN_EXPLORERS[MONAD_CHAIN_ID];
  return `${explorer}/address/${address}`;
}

export function chainIdToNetwork(chainId?: number): string {
  if (chainId === MONAD_CHAIN_ID || chainId === MONAD_TESTNET_CHAIN_ID) return "monad";
  if (chainId === 1) return "mainnet";
  return "monad";
}

export function chainIdToLabel(chainId?: number): string {
  if (chainId === MONAD_CHAIN_ID) return "Monad";
  if (chainId === MONAD_TESTNET_CHAIN_ID) return "Monad Testnet";
  if (chainId === 1) return "Ethereum";
  if (chainId === 42161) return "Arbitrum";
  if (chainId === 10) return "Optimism";
  return "Monad";
}

export type ChainToken = {
  symbol: string;
  name: string;
  /** null means the chain's native asset (MON), which has no ERC-20 address. */
  address: `0x${string}` | null;
  decimals: number;
  stable?: boolean;
  /** Whether the backend accepts this token as a plan's starting token. */
  inputEnabled?: boolean;
};

/**
 * Fallback token list, mirroring the chain registry in
 * Monad_Backend/src/boot.ts. Every address was verified against live Monad RPC
 * — see Monad_Contract/Fortress/ADDRESSES.md §2.
 *
 * This is a FALLBACK, not the source of truth. Prefer `useRegistry()`, which
 * reads GET /fortress/registry so the picker can never drift from what the
 * backend will actually accept. Drift is exactly what broke the Base->Monad
 * cutover: the picker offered Base USDC, and every plan came back
 * "doesn't start from your selected token".
 */
export const MONAD_TOKENS: ChainToken[] = [
  { symbol: "USDC", name: "USD Coin", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, stable: true, inputEnabled: true },
  { symbol: "WMON", name: "Wrapped Monad", address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", decimals: 18 },
  { symbol: "WETH", name: "Wrapped Ether", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18 },
  { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
  { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b", decimals: 8 },
  { symbol: "USDT0", name: "Tether USD (USDT0)", address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6, stable: true },
  { symbol: "AUSD", name: "Agora Dollar", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6, stable: true },
  { symbol: "shMON", name: "FastLane Staked MON", address: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c", decimals: 18 },
];

/** The token the vault denominates everything in. */
export const MONAD_USDC = MONAD_TOKENS[0].address as `0x${string}`;

/** Native MON — not an ERC-20, so it has no address of its own. */
export const NATIVE_MON: ChainToken = {
  symbol: "MON",
  name: "Monad",
  address: null,
  decimals: 18,
};

/** address (lowercased) -> { symbol, decimals }, for rendering amounts. */
export const MONAD_TOKEN_META: Record<string, { symbol: string; name: string; decimals: number }> =
  Object.fromEntries(
    MONAD_TOKENS.filter((t) => t.address).map((t) => [
      (t.address as string).toLowerCase(),
      { symbol: t.symbol, name: t.name, decimals: t.decimals },
    ]),
  );
