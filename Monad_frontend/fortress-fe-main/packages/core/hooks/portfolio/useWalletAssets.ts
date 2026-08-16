"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useReadContracts } from "wagmi";
import { erc20Abi, formatUnits } from "viem";

const MONAD_CHAIN_ID = 143;
const MONAD_TESTNET_CHAIN_ID = 10143;

// ─── Addresses shown in the "Protocol Tokens" section — excluded from the
//     Wallet Assets list to avoid double-counting / confusion. ────────────────
const PROTOCOL_TOKEN_ADDRESSES = new Set([
  "0x21adbb60a5fb909e7f1fb48aacc4569615cd97b5", // cUSDC (Curvance)
  "0x1905eddf5943ef6c92ccf1469bd40fc2cb4a77b0", // eUSDC (Euler)
  "0x78999cc96d2ba0341588c60ccb0e91c6c33cf371", // Hyperithm USDC Apex (Morpho)
  "0x35a73bacb179d3740395a3cecc87ff2e581d6042", // aMonUSDC (Aave V3 Monad)
  "0x38648958836ea88b368b4ac23b86ad44b0fe7508", // nUSDC (Neverland)
]);

// ─── Token registry for Monad ─────────────────────────────────────────────────

export interface TokenDef {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  /** Omit for vault shares — those are priced via `vault` instead. */
  coingeckoId?: string;
  /**
   * ERC-4626 vault shares aren't 1:1 with their underlying and generally
   * aren't listed on CoinGecko — price them via the vault's own exchange
   * rate (convertToAssets) against the underlying's market price instead.
   */
  vault?: { underlyingDecimals: number; underlyingCoingeckoId: string };
  /** Set only for protocol position tokens (see PROTOCOL_TOKEN_ADDRESSES) — the "via X" label in the Protocol Tokens section. */
  protocolName?: string;
}

// Every address verified against live Monad RPC (ADDRESSES.md §2), and every
// coingeckoId verified to resolve against the live CoinGecko simple/price API.
// Note AUSD is "agora-dollar" — the id "ausd" is a DIFFERENT asset trading
// near $0.03, and using it would misprice the position by ~30x.
export const MONAD_TOKENS: TokenDef[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x754704bc059f8c67012fed69bc8a327a5aafb603",
    decimals: 6,
    coingeckoId: "usd-coin",
  },
  {
    symbol: "WMON",
    name: "Wrapped Monad",
    address: "0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    decimals: 18,
    coingeckoId: "wrapped-monad",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242",
    decimals: 18,
    coingeckoId: "weth",
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c",
    decimals: 8,
    coingeckoId: "wrapped-bitcoin",
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-btc",
  },
  {
    symbol: "USDT0",
    name: "Tether USD",
    address: "0xe7cd86e13ac4309349f30b3435a9d337750fc82d",
    decimals: 6,
    coingeckoId: "usdt0",
  },
  {
    symbol: "AUSD",
    name: "Agora Dollar",
    address: "0x00000000efe302beaa2b3e6e1b18d08d69a9012a",
    decimals: 6,
    coingeckoId: "agora-dollar",
  },
  {
    symbol: "shMON",
    name: "FastLane Staked MON",
    address: "0x1b68626dca36c7fe922fd2d55e4f631d962de19c",
    decimals: 18,
    coingeckoId: "shmonad",
  },

  // ─── Protocol position tokens (PROTOCOL_TOKEN_ADDRESSES) ───────────────────
  // The ERC-4626 vaults price off their own convertToAssets against USDC.
  {
    symbol: "cUSDC",
    name: "Curvance USDC",
    address: "0x21adbb60a5fb909e7f1fb48aacc4569615cd97b5",
    decimals: 18,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Curvance",
  },
  {
    symbol: "eUSDC",
    name: "Euler USDC",
    address: "0x1905eddf5943ef6c92ccf1469bd40fc2cb4a77b0",
    decimals: 18,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Euler",
  },
  {
    symbol: "Hyperithm USDC Apex",
    name: "Hyperithm USDC Apex",
    address: "0x78999cc96d2ba0341588c60ccb0e91c6c33cf371",
    decimals: 18,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Morpho",
  },
  // aTokens rebase 1:1 with the underlying and are NOT ERC-4626 — asset(),
  // totalAssets() and convertToAssets() all revert on them. Price them
  // directly off USDC instead of giving them a `vault` block.
  {
    symbol: "aMonUSDC",
    name: "Aave V3 USDC",
    address: "0x35a73bacb179d3740395a3cecc87ff2e581d6042",
    decimals: 6,
    coingeckoId: "usd-coin",
    protocolName: "Aave",
  },
  {
    symbol: "nUSDC",
    name: "Neverland USDC",
    address: "0x38648958836ea88b368b4ac23b86ad44b0fe7508",
    decimals: 6,
    coingeckoId: "usd-coin",
    protocolName: "Neverland",
  },
];

// CoinGecko IDs we need — ETH, MON + all ERC-20s (vault shares are priced via
// their own exchange rate, not a direct CoinGecko listing).
const ALL_COINGECKO_IDS = [
  "ethereum",
  "monad",
  ...MONAD_TOKENS.map((t) => t.coingeckoId).filter((id): id is string => !!id),
];

// Minimal ERC-4626 read surface — just enough to price vault shares.
const ERC4626_ABI = [
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

// ─── Price fetching ───────────────────────────────────────────────────────────

type PriceMap = Record<string, number>;

async function fetchPrices(ids: string[]): Promise<PriceMap> {
  try {
    const url =
      "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=" +
      ids.join(",");
    const res = await fetch(url);
    if (!res.ok) return { monad: 0.021 };
    const json = await res.json();
    const map: PriceMap = { monad: 0.021 };
    for (const [id, data] of Object.entries(json)) {
      map[id] = (data as { usd: number }).usd;
    }
    return map;
  } catch {
    return { monad: 0.021 };
  }
}

// ─── Public shape ────────────────────────────────────────────────────────────

export interface LiveAsset {
  symbol: string;
  name: string;
  /** "native" for ETH/MON, token address for ERC-20s */
  address: string;
  decimals: number;
  balance: number;
  priceUsd: number;
  valueUsd: number;
  /** Set only for protocol position tokens — the "via X" label in the Protocol Tokens section. */
  protocolName?: string;
}

export interface UseWalletAssetsResult {
  assets: LiveAsset[];
  /** Tokens in PROTOCOL_TOKEN_ADDRESSES (e.g. mwUSDC vault shares) — priced
   * and balanced the same way as `assets`, just kept out of the plain wallet
   * list since callers show them in their own "Protocol Tokens" section. */
  protocolAssets: LiveAsset[];
  totalUsd: number;
  isLoading: boolean;
  isError: boolean;
  /** True when wagmi is connected but prices are still fetching */
  isPricePending: boolean;
  /** Re-read on-chain balances + vault rates + prices (call after a mutation). */
  refetch: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWalletAssets(): UseWalletAssetsResult {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  // Monad only. A wallet parked on some other network still reads Monad
  // mainnet rather than silently showing an empty portfolio.
  const activeChainId = chainId === MONAD_TESTNET_CHAIN_ID ? MONAD_TESTNET_CHAIN_ID : MONAD_CHAIN_ID;

  // ── 1. Native balance (MON) ──
  const {
    data: nativeData,
    isLoading: nativeLoading,
    isError: nativeError,
    refetch: refetchNative,
  } = useBalance({
    address,
    chainId: activeChainId,
    query: { enabled: !!address },
  });

  // ── 2. All ERC-20 balances, plus each vault's exchange rate, in one multicall ──
  const activeTokens = MONAD_TOKENS;
  const vaultTokens = activeTokens.filter((t) => t.vault);

  const contracts = [
    ...activeTokens.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
      chainId: activeChainId,
    })),
    // Value of one whole share, in underlying-asset units — independent of
    // the user's balance, so it can sit in the same batch as the balance
    // reads above rather than needing a dependent second call.
    ...vaultTokens.map((token) => ({
      address: token.address,
      abi: ERC4626_ABI,
      functionName: "convertToAssets",
      args: [BigInt(10) ** BigInt(token.decimals)],
      chainId: activeChainId,
    })),
  ];

  const {
    data: tokenData,
    isLoading: tokensLoading,
    isError: tokensError,
    refetch: refetchTokens,
  } = useReadContracts({
    contracts,
    query: {
      enabled: !!address && contracts.length > 0,
      // Force a fresh on-chain read every time refetch() is called (after a
      // deploy/withdraw mutation). Without this, React Query may serve the
      // stale cached zero-balance for newly-minted tokens like Pendle PT.
      staleTime: 0,
    },
  });

  // ── 3. Prices from CoinGecko ──
  const [prices, setPrices] = useState<PriceMap>({ monad: 0.021 });
  const [isPricePending, setIsPricePending] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsPricePending(true);
    fetchPrices(ALL_COINGECKO_IDS).then((map) => {
      if (!cancelled) {
        setPrices(map);
        setIsPricePending(false);
      }
    });
    // Refresh every 60 s
    const interval = setInterval(() => {
      fetchPrices(ALL_COINGECKO_IDS).then((map) => {
        if (!cancelled) setPrices(map);
      });
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Re-read on-chain balances (ETH/MON + all ERC-20s + vault rates) and refresh
  // prices. Balances come from the chain directly, so unlike Morpho positions
  // there's no indexer lag — a single refetch after a mutation is accurate.
  const refetch = useCallback(() => {
    refetchNative();
    refetchTokens();
    fetchPrices(ALL_COINGECKO_IDS)
      .then((map) => setPrices(map))
      .catch(() => {});
  }, [refetchNative, refetchTokens]);

  // ── 4. Assemble assets ──
  const isLoading = nativeLoading || (contracts.length > 0 && tokensLoading);
  const isError = nativeError || (contracts.length > 0 && tokensError);

  if (!isConnected || !address || isLoading) {
    return {
      assets: [],
      protocolAssets: [],
      totalUsd: 0,
      isLoading,
      isError: false,
      isPricePending,
      refetch,
    };
  }

  const assets: LiveAsset[] = [];
  const protocolAssets: LiveAsset[] = [];

  // Native token (MON)
  if (nativeData) {
    const balance = parseFloat(
      formatUnits(nativeData.value, nativeData.decimals),
    );
    if (balance > 0.000001) {
      const priceUsd = prices["monad"] ?? 0.021;
      assets.push({
        symbol: "MON",
        name: "Monad",
        address: "native",
        decimals: nativeData.decimals,
        balance,
        priceUsd,
        valueUsd: balance * priceUsd,
      });
    }
  }

  // ERC-20s
  activeTokens.forEach((token, i) => {
    const result = tokenData?.[i];
    if (result?.status !== "success") return;
    const raw = result.result as bigint;
    const balance = parseFloat(formatUnits(raw, token.decimals));
    if (balance < 0.000001) return; // skip dust

    let priceUsd = 0;
    if (token.vault) {
      const rateResult =
        tokenData?.[activeTokens.length + vaultTokens.indexOf(token)];
      if (rateResult?.status === "success") {
        const oneShareInUnderlying = parseFloat(
          formatUnits(
            rateResult.result as bigint,
            token.vault.underlyingDecimals,
          ),
        );
        priceUsd =
          oneShareInUnderlying *
          (prices[token.vault.underlyingCoingeckoId] ?? 0);
      }
    } else {
      priceUsd = prices[token.coingeckoId ?? ""] ?? 0;
    }

    const asset: LiveAsset = {
      symbol: token.symbol,
      name: token.name,
      address: token.address,
      decimals: token.decimals,
      balance,
      priceUsd,
      valueUsd: balance * priceUsd,
      protocolName: token.protocolName,
    };

    if (PROTOCOL_TOKEN_ADDRESSES.has(token.address.toLowerCase())) {
      protocolAssets.push(asset);
    } else {
      assets.push(asset);
    }
  });

  // Sort by USD value descending
  assets.sort((a, b) => b.valueUsd - a.valueUsd);

  const totalUsd = assets.reduce((s, a) => s + a.valueUsd, 0);

  return {
    assets,
    protocolAssets,
    totalUsd,
    isLoading: false,
    isError,
    isPricePending,
    refetch,
  };
}
