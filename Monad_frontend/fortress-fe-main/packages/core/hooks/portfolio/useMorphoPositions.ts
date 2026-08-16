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

// Monad token metadata for Morpho Blue position rendering.
//
// FORTRESS registers no Morpho Blue markets on Monad — the leverage/exit
// executors that would open positions against them are not deployed — so this
// map only needs the chain's own tokens. It replaced a ~40-entry Base
// collateral registry (cbETH/cbXRP/cbDOGE/JitoSOL/...) whose addresses have no
// code on Monad. Extend it when markets are registered, not before.
const TOKEN_META: Record<string, { symbol: string; name: string; decimals: number }> = {
  "0x754704bc059f8c67012fed69bc8a327a5aafb603": { symbol: "USDC",  name: "USD Coin",            decimals: 6  },
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a": { symbol: "WMON",  name: "Wrapped Monad",       decimals: 18 },
  "0xee8c0e9f1bffb4eb878d8f15f368a02a35481242": { symbol: "WETH",  name: "Wrapped Ether",       decimals: 18 },
  "0x0555e30da8f98308edb960aa94c0db47230d2b9c": { symbol: "WBTC",  name: "Wrapped Bitcoin",     decimals: 8  },
  "0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b": { symbol: "cbBTC", name: "Coinbase Wrapped BTC", decimals: 8  },
  "0xe7cd86e13ac4309349f30b3435a9d337750fc82d": { symbol: "USDT0", name: "Tether USD",          decimals: 6  },
  "0x00000000efe302beaa2b3e6e1b18d08d69a9012a": { symbol: "AUSD",  name: "Agora Dollar",        decimals: 6  },
  "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": { symbol: "shMON", name: "FastLane Staked MON", decimals: 18 },
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
