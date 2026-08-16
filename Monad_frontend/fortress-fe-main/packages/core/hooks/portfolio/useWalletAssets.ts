"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useBalance, useChainId, useReadContracts } from "wagmi";
import { base } from "@reown/appkit/networks";
import { erc20Abi, formatUnits } from "viem";

// ─── Addresses shown in the "Protocol Tokens" section — excluded from the
//     Wallet Assets list to avoid double-counting / confusion. ────────────────
const PROTOCOL_TOKEN_ADDRESSES = new Set([
  "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9", // Steakhouse Prime USDC V2 (Morpho)
  "0xc768c589647798a6ee01a91fde98ef2ed046dbd6", // waBasUSDC (Aave)
  "0xf42f5795d9ac7e9d757db633d693cd548cfd9169", // fUSDC (Fluid)
  "0x8bf41ad2b816f7c220b22f4bcd63fc2a35ab4247", // CSEUSDC (Clearstar Earn, via Euler)
  "0xb125e6687d4313864e53df431d5425969c15eb2f", // cUSDCv3 (Compound)
  "0x3623567972ad7f44242ec354a38bdbacfc73aa42", // PT-40acresUSDC (Pendle)
]);

// ─── Token registry for Base chain ───────────────────────────────────────────

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

export const BASE_TOKENS: TokenDef[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    coingeckoId: "usd-coin",
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    coingeckoId: "weth",
  },
  {
    symbol: "cbETH",
    name: "Coinbase Staked ETH",
    address: "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
    decimals: 18,
    coingeckoId: "coinbase-wrapped-staked-eth",
  },
  {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-btc",
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
    decimals: 6,
    coingeckoId: "tether",
  },
  {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
    decimals: 18,
    coingeckoId: "dai",
  },
  {
    symbol: "LBTC",
    name: "Lombard Staked BTC",
    // Was "0xecac9c5f704e954931349da37f60bb39c9223e37" — that address has no
    // deployed contract on Base (eth_call symbol() → "0x", empty). Corrected
    // against Morpho's API + on-chain symbol() confirmation.
    address: "0xecac9c5f704e954931349da37f60e39f515c11c1",
    decimals: 8,
    coingeckoId: "lombard-staked-btc",
  },
  {
    symbol: "ezETH",
    name: "Renzo Restaked ETH",
    address: "0x2416092f143378750bb29b79ed961ab195cceea5",
    decimals: 18,
    coingeckoId: "renzo-restaked-eth",
  },
  {
    // Minted when a user deposits USDC into the Morpho allocation — Steakhouse
    // Prime USDC V2 vault (ERC-4626, 18-decimal shares, 6-decimal USDC underlying).
    symbol: "steakUSDC",
    name: "Steakhouse Prime USDC",
    address: "0xbeef0e0834849acc03f0089f01f4f1eeb06873c9",
    decimals: 18,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Morpho",
  },
  {
    // Aave's ERC-4626 wrapper around the rebasing aBasUSDC aToken. Verified
    // on-chain: symbol() = "waBasUSDC", decimals() = 6, asset() = USDC.
    symbol: "waBasUSDC",
    name: "Wrapped Aave Base USDC",
    address: "0xc768c589647798a6ee01a91fde98ef2ed046dbd6",
    decimals: 6,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Aave",
  },
  {
    // Fluid's ERC-4626 lending vault share. Verified on-chain: symbol() =
    // "fUSDC", decimals() = 6, asset() = USDC.
    symbol: "fUSDC",
    name: "Fluid USDC",
    address: "0xf42f5795d9ac7e9d757db633d693cd548cfd9169",
    decimals: 6,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Fluid",
  },
  {
    // Clearstar Earn USDC — the curated Euler vault our backend's protocol
    // registry actually deposits into.
    // Verified on-chain: symbol() = "CSEUSDC", name() = "Clearstar Earn
    // USDC", decimals() = 6, asset() = USDC. (The prior symbol/name here —
    // eeUSDC / Euler Earn USDC — described the vault this address used to
    // point at, before it was swapped out for pointing to a different,
    // active vault; the label was never updated to match.)
    symbol: "CSEUSDC",
    name: "Clearstar Earn USDC",
    address: "0x8bf41ad2b816f7c220b22f4bcd63fc2a35ab4247",
    decimals: 6,
    vault: { underlyingDecimals: 6, underlyingCoingeckoId: "usd-coin" },
    protocolName: "Euler",
  },
  {
    // Compound's Comet base token — matches the backend's CompoundV3
    // `positionToken` (prompt_2_defi/src/chains/evm/config/base.ts). NOT an
    // ERC-4626 vault: balanceOf already tracks the user's USDC-equivalent
    // principal + accrued interest 1:1 (asset() reverts — confirmed on-chain
    // this isn't vault-wrapped), so it's priced directly via coingeckoId
    // instead of convertToAssets like the other three.
    symbol: "cUSDCv3",
    name: "Compound USDC",
    address: "0xb125e6687d4313864e53df431d5425969c15eb2f",
    decimals: 6,
    coingeckoId: "usd-coin",
    protocolName: "CompoundV3",
  },
  {
    // Pendle PT-40acresUSDC — the principal token minted when depositing USDC
    // into Pendle's 40acresUSDC market (via the vault adapter). NOT an ERC-4626
    // vault; redeemable for ~1 USDC at maturity, so priced at par via the
    // "usd-coin" coingeckoId (a slight simplification — pre-maturity it trades
    // at a small discount reflecting the implied APY, but for portfolio display
    // par pricing is within 2-5% and avoids a Pendle SDK call per refresh).
    // Verified on-chain: symbol() = "PT-40acresUSDC-27AUG2026", decimals() = 18.
    symbol: "PT-40acres",
    name: "PT 40acresUSDC",
    address: "0x3623567972ad7f44242ec354a38bdbacfc73aa42",
    decimals: 18,
    coingeckoId: "usd-coin",
    protocolName: "Pendle",
  },
  // Added from a live audit of Morpho's Base markets — every collateral/loan
  // token backing a market with >$500k TVL at audit time. Addresses/decimals
  // verified against Morpho's public API + on-chain calls; coingeckoIds
  // confirmed by cross-checking each candidate listing's own `platforms.base`
  // address against ours (several symbols have multiple similarly-named
  // CoinGecko listings — picking the wrong one silently mispricess the asset).
  {
    symbol: "wstETH",
    name: "Wrapped Staked ETH",
    address: "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
    decimals: 18,
    // NOT "wrapped-steth" — that listing has no `platforms.base` entry at
    // all. This is the Base-specific bridged listing, verified by address.
    coingeckoId: "superbridge-bridged-wsteth-base",
  },
  {
    symbol: "weETH",
    name: "Wrapped eETH",
    address: "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a",
    decimals: 18,
    coingeckoId: "wrapped-eeth",
  },
  {
    symbol: "HERMES",
    name: "Hermes",
    address: "0x4bcaf180df5b13c0441fe41a66e9638a2a410c6d",
    decimals: 18,
    // No coingeckoId: CoinGecko has 3 similarly-named "Hermes" listings and
    // none of their platforms.base addresses matched ours — leave unpriced
    // (shows balance, $0 value) rather than risk pricing it as a different
    // token entirely.
  },
  {
    symbol: "USDe",
    name: "Ethena USDe",
    address: "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34",
    decimals: 18,
    coingeckoId: "ethena-usde",
  },
  {
    symbol: "cbXRP",
    name: "Coinbase Wrapped XRP",
    address: "0xcb585250f852c6c6bf90434ab21a00f02833a4af",
    decimals: 6,
    coingeckoId: "coinbase-wrapped-xrp",
  },
  {
    symbol: "USR",
    name: "Resolv USR",
    address: "0x35e5db674d8e93a03d814fa0ada70731efe8a4b9",
    decimals: 18,
    coingeckoId: "resolv-usr",
  },
  {
    symbol: "SOL",
    name: "Wrapped SOL",
    address: "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82",
    decimals: 9,
    // "base-bridged-sol-base" verified by address, not "solana" or
    // "wrapped-solana" — CoinGecko lists a dozen bridged-SOL variants.
    coingeckoId: "base-bridged-sol-base",
  },
  {
    symbol: "wsuperOETHb",
    name: "Wrapped Super OETH Base",
    address: "0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6",
    decimals: 18,
    coingeckoId: "wrapped-super-oeth",
  },
  {
    symbol: "msETH",
    name: "Metronome Synth ETH",
    address: "0x7ba6f01772924a82d9626c126347a28299e98c98",
    decimals: 18,
    coingeckoId: "metronome-synth-eth",
  },
  {
    symbol: "cbADA",
    name: "Coinbase Wrapped ADA",
    address: "0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c",
    decimals: 6,
    coingeckoId: "coinbase-wrapped-ada",
  },
  {
    symbol: "cbDOGE",
    name: "Coinbase Wrapped DOGE",
    address: "0xcbd06e5a2b0c65597161de254aa074e489deb510",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-doge",
  },
  {
    symbol: "XSGD",
    name: "StraitsX Singapore Dollar",
    address: "0x0a4c9cb2778ab3302996a34befcf9a8bc288c33b",
    decimals: 6,
    coingeckoId: "xsgd",
  },
  {
    symbol: "cbLTC",
    name: "Coinbase Wrapped LTC",
    address: "0xcb17c9db87b595717c857a08468793f5bab6445f",
    decimals: 8,
    coingeckoId: "coinbase-wrapped-ltc",
  },
  {
    symbol: "JitoSOL",
    name: "Jito Staked SOL",
    address: "0x97be14dd8f994a5364573bc035d85309e7cb34de",
    decimals: 9,
    coingeckoId: "jito-staked-sol",
  },
];

// CoinGecko IDs we need — ETH, MON + all ERC-20s (vault shares are priced via
// their own exchange rate, not a direct CoinGecko listing).
const ALL_COINGECKO_IDS = [
  "ethereum",
  "monad",
  ...BASE_TOKENS.map((t) => t.coingeckoId).filter((id): id is string => !!id),
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

  const isMonadChain = chainId === 10143 || chainId === 143;
  const activeChainId = isMonadChain ? chainId : base.id;

  // ── 1. Native balance (MON on Monad, ETH on Base) ──
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
  const activeTokens = isMonadChain ? [] : BASE_TOKENS;
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

  // Native token (MON on Monad, ETH on Base)
  if (nativeData) {
    const balance = parseFloat(
      formatUnits(nativeData.value, nativeData.decimals),
    );
    if (balance > 0.000001) {
      const isMon = isMonadChain;
      const symbol = isMon ? "MON" : "ETH";
      const name = isMon ? "Monad" : "Ether";
      const priceUsd = isMon
        ? (prices["monad"] ?? 0.021)
        : (prices["ethereum"] ?? 0);
      assets.push({
        symbol,
        name,
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
