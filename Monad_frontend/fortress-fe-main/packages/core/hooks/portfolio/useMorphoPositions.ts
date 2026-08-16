"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { fortressApi, type FortressClient } from "../../api/client";
import type { PositionApi } from "../../types";

// ─── Public shape (mapped from the Fortress API — see apiPositionToMorpho) ───

export interface MorphoPosition {
  id: string;
  market: string;
  collateralSymbol: string;
  borrowSymbol: string;
  network: string;
  networkLabel: string;
  /** USD value of supplied collateral */
  collateralUsd: number;
  /** USD value of outstanding borrow */
  borrowUsd: number;
  /** Current loan-to-value as a fraction 0-1 */
  ltv: number;
  /** Max allowed LTV (liquidation threshold) as a fraction 0-1 */
  maxLtv: number;
  /** Health factor (maxLtv / ltv, or 99 when there's no borrow) */
  healthFactor: number;
  /** Not split by the API today — always 0, kept for forward-compat */
  supplyApy: number;
  /** Not split by the API today — always 0, kept for forward-compat */
  borrowApy: number;
  /** Net APY, as a percentage */
  netApy: number;
}

// ─── Token address → symbol/name map (Base chain) ────────────────────────────

const TOKEN_META: Record<string, { symbol: string; name: string; decimals: number }> = {
  // collateral tokens
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH",  name: "Coinbase Staked ETH",    decimals: 18 },
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC",  name: "Coinbase Wrapped BTC",   decimals: 8  },
  "0x2416092f143378750bb29b79ed961ab195cceea5": { symbol: "ezETH",  name: "Renzo Restaked ETH",     decimals: 18 },
  // Was "0xecac9c5f704e954931349da37f60bb39c9223e37" — that address has no
  // deployed contract on Base (verified via eth_call symbol() → "0x", empty).
  // Corrected against Morpho's own API + on-chain symbol() confirmation.
  "0xecac9c5f704e954931349da37f60e39f515c11c1": { symbol: "LBTC",   name: "Lombard Staked BTC",      decimals: 8  },
  "0x4200000000000000000000000000000000000006": { symbol: "WETH",   name: "Wrapped Ether",           decimals: 18 },
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": { symbol: "wstETH", name: "Wrapped Staked ETH",       decimals: 18 },
  "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": { symbol: "weETH",  name: "Wrapped eETH",             decimals: 18 },
  "0x4bcaf180df5b13c0441fe41a66e9638a2a410c6d": { symbol: "HERMES", name: "Hermes",                   decimals: 18 },
  "0xcb585250f852c6c6bf90434ab21a00f02833a4af": { symbol: "cbXRP",  name: "Coinbase Wrapped XRP",     decimals: 6  },
  "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82": { symbol: "SOL",    name: "Wrapped SOL",              decimals: 9  },
  "0x7fcd174e80f264448ebee8c88a7c4476aaf58ea6": { symbol: "wsuperOETHb", name: "Wrapped Super OETH Base", decimals: 18 },
  "0xcbada732173e39521cdbe8bf59a6dc85a9fc7b8c": { symbol: "cbADA",  name: "Coinbase Wrapped ADA",     decimals: 6  },
  "0xcbd06e5a2b0c65597161de254aa074e489deb510": { symbol: "cbDOGE", name: "Coinbase Wrapped DOGE",    decimals: 8  },
  "0xcb17c9db87b595717c857a08468793f5bab6445f": { symbol: "cbLTC",  name: "Coinbase Wrapped LTC",     decimals: 8  },
  "0x97be14dd8f994a5364573bc035d85309e7cb34de": { symbol: "JitoSOL", name: "Jito Staked SOL",         decimals: 9  },
  // loan tokens
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC",   name: "USD Coin",                decimals: 6  },
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2": { symbol: "USDT",   name: "Tether USD",              decimals: 6  },
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42": { symbol: "EURC",   name: "Euro Coin",                decimals: 6  },
  "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34": { symbol: "USDe",   name: "Ethena USDe",              decimals: 18 },
  "0x35e5db674d8e93a03d814fa0ada70731efe8a4b9": { symbol: "USR",    name: "Resolv USR",               decimals: 18 },
  "0x7ba6f01772924a82d9626c126347a28299e98c98": { symbol: "msETH",  name: "Metronome Synth ETH",      decimals: 18 },
  "0xbeefe94c8ad530842bfe7d8b397938ffc1cb83b2": { symbol: "steakUSDC", name: "Steakhouse USDC",       decimals: 18 },
  "0x0a4c9cb2778ab3302996a34befcf9a8bc288c33b": { symbol: "XSGD",   name: "StraitsX Singapore Dollar", decimals: 6  },
};

function resolveToken(address: string) {
  return (
    TOKEN_META[address.toLowerCase()] ?? {
      symbol: address.slice(0, 6) + "…",
      name: "Unknown token",
      decimals: 18,
    }
  );
}

// collateralValue comes in loan-token raw units (USDC = 6dp, so divide by 1e6)
function rawToUsd(raw: string, decimals = 6): number {
  return Number(raw) / 10 ** decimals;
}

function apiPositionToMorpho(p: PositionApi): MorphoPosition {
  const collateralMeta = resolveToken(p.collateralToken);
  const loanMeta       = resolveToken(p.loanToken);

  const collateralUsd = rawToUsd(p.collateralValue, loanMeta.decimals);
  const borrowUsd     = rawToUsd(p.debt, loanMeta.decimals);

  // Health factor: how far from liquidation — lltv / ltv
  // Guard against ltv === 0 (no borrow) → show ∞ as 99
  const healthFactor = p.ltv > 0 ? p.lltv / p.ltv : 99;

  // netApy from the API is a fraction (e.g. 0.0106 = 1.06%).
  // We display it as a percentage so multiply by 100.
  const netApyPct = p.netApy * 100;

  // The API doesn't split supply/borrow APY separately.
  // Approximate: show net as-is; leave supply/borrow as 0 placeholders
  // so the pill row is omitted cleanly (we hide them when 0).
  return {
    id: p.marketKey,
    market: `${collateralMeta.symbol} / ${loanMeta.symbol}`,
    collateralSymbol: collateralMeta.symbol,
    borrowSymbol: loanMeta.symbol,
    network: "base",
    networkLabel: "Base",
    collateralUsd,
    borrowUsd,
    ltv: p.ltv,
    maxLtv: p.lltv,
    healthFactor,
    supplyApy: 0,   // not provided by API
    borrowApy: 0,   // not provided by API
    netApy: netApyPct,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseMorphoPositionsResult {
  positions: MorphoPosition[];
  isLoading: boolean;
  isError: boolean;
  stale: boolean;
  refetch: () => void;
}

// `client` defaults to web's fortressApi singleton (Next.js proxy base) so
// existing web call sites are unaffected. Mobile has no Next.js proxy, so it
// builds its own client (absolute backend URL) and passes it explicitly.
export function useMorphoPositions(client: FortressClient = fortressApi): UseMorphoPositionsResult {
  const { address, isConnected } = useAccount();

  const [positions, setPositions]   = useState<MorphoPosition[]>([]);
  const [isLoading, setIsLoading]   = useState(false);
  const [isError, setIsError]       = useState(false);
  const [stale, setStale]           = useState(false);
  const [tick, setTick]             = useState(0);

  // Track the last address we fired a first-paint refresh for so we don't
  // re-fire on every tick increment — only when the wallet changes.
  const refreshedForRef = useRef<string | null>(null);
  const lastTickRef = useRef(0);

  useEffect(() => {
    if (!isConnected || !address) {
      setPositions([]);
      refreshedForRef.current = null;
      lastTickRef.current = tick;
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsError(false);

    const fetchPositions = async () => {
      try {
        const isFirstPaint = refreshedForRef.current !== address;
        const isManualRefetch = tick !== lastTickRef.current;
        lastTickRef.current = tick;

        // First-paint or manual refresh: evict cache on backend and get live data
        if (isFirstPaint || isManualRefetch) {
          refreshedForRef.current = address;
          await client.refreshPositions(address);
        }

        const data = await client.getPositions(address);
        if (cancelled) return;
        const mapped = data.positions
          .map(apiPositionToMorpho)
          .filter((p) => p.collateralUsd > 0 || p.borrowUsd > 0);
        setPositions(mapped);
        setStale(data.stale);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("[useMorphoPositions] getPositions failed:", err);
        setIsError(true);
        setIsLoading(false);
      }
    };

    fetchPositions();

    return () => {
      cancelled = true;
    };
  }, [address, isConnected, tick, client]);

  return {
    positions,
    isLoading,
    isError,
    stale,
    refetch: () => setTick((t) => t + 1),
  };
}
