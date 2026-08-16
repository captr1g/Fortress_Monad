import { createPublicClient, http } from "viem";
import type { Redis } from "ioredis";
import { resolveProtocolEntry, type EvmChainConfig, type ProtocolEntry } from "@chains/evm/types.js";
import { norm } from "@chains/evm/helper/utils.js";
import {
  aavePoolAbi,
  cometAbi,
  erc4626Abi,
} from "@chains/evm/config/base_abi.js";
import type { DepositLeg, DepositApy } from "@domains/yield/types/market.js";

const MORPHO_GRAPHQL = "https://blue-api.morpho.org/graphql";
const DEFILLAMA_CHART = "https://yields.llama.fi/chart";
const TIMEOUT_MS = 10_000;
const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;
// ~7 days of Base blocks (2s), used to sample ERC-4626 share-price growth.
const SAMPLE_BLOCK_OFFSET = 302_400n;
const AAVE_POOL_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const CACHE_TTL_SECONDS = 120;
const CACHE_PREFIX = "vault-apy:";

// Pendle's rate is per-market, not per-protocol — key the cache on the
// resolved market address so two different markets never share a cached APY.
// Exported so the warmer and the prompt-rate reader use the exact same key
// scheme as the writer below; a drifted duplicate here would silently mean
// "warmed" and "read" never actually line up.
export function vaultApyCacheKey(protocol: ProtocolEntry, pendleMarket?: string, aerodromePool?: string): string {
  if (protocol.apySource === "pendle-implied" && pendleMarket)
    return `${CACHE_PREFIX}pendle-implied:${pendleMarket.toLowerCase()}`;
  if (protocol.apySource === "aerodrome-gauge" && aerodromePool)
    return `${CACHE_PREFIX}aerodrome-gauge:${aerodromePool.toLowerCase()}`;
  return `${CACHE_PREFIX}${protocol.apySource}:${protocol.address.toLowerCase()}`;
}

// Live supply APY for a vault protocol, freshness-gated through Redis (120s TTL).
// Source per protocol: Morpho API netApy, on-chain Aave liquidity rate, on-chain
// Compound Comet supply rate, or a DefiLlama pool. Returns null (never a fabricated
// value) when the source is missing or fails — and a failed fetch caches nothing.
export async function fetchProtocolApy(
  protocol: ProtocolEntry,
  rpcUrl: string,
  redis?: Redis,
  pendleMarket?: string,
  aerodromePool?: string,
): Promise<number | null> {
  if (protocol.apySource === "none") return null;

  const cacheKey = vaultApyCacheKey(protocol, pendleMarket, aerodromePool);
  if (redis) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached !== null) return Number(cached);
  }

  const apy = await fetchBySource(protocol, rpcUrl, pendleMarket, aerodromePool);

  if (redis && apy !== null) {
    await redis
      .set(cacheKey, String(apy), "EX", CACHE_TTL_SECONDS)
      .catch(() => undefined);
  }
  return apy;
}

// Dispatches to the protocol's configured rate source.
async function fetchBySource(
  protocol: ProtocolEntry,
  rpcUrl: string,
  pendleMarket?: string,
  aerodromePool?: string,
): Promise<number | null> {
  switch (protocol.apySource) {
    case "morpho-vault":
      return fetchMorphoVaultApy(protocol.address);
    case "aave-pool":
      return fetchAaveSupplyApy(rpcUrl);
    case "compound-comet":
      return fetchCompoundApy(protocol.positionToken, rpcUrl);
    case "aerodrome-gauge":
      return fetchAerodromeGaugeApy(protocol, rpcUrl, aerodromePool);
    case "defillama":
      return fetchDefiLlamaApy(protocol.defiLlamaPoolId);
    case "pendle-implied":
      return fetchPendleImpliedApy(protocol, pendleMarket);
    case "erc4626-onchain":
      // For adapter-pattern protocols (e.g. Yo), positionToken is the actual
      // ERC-4626 vault that accrues yield; protocol.address is the adapter.
      return fetchErc4626OnchainApy(protocol.positionToken ?? protocol.address, rpcUrl);
    default:
      return null;
  }
}

async function fetchMorphoVaultApy(
  vault: `0x${string}`,
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(MORPHO_GRAPHQL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{ vaultByAddress(address:"${vault}", chainId:8453){ state { netApy } } }`,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { vaultByAddress?: { state?: { netApy?: number } } };
    };
    const netApy = json.data?.vaultByAddress?.state?.netApy;
    return typeof netApy === "number" ? netApy : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAaveSupplyApy(rpcUrl: string): Promise<number | null> {
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const data = (await client.readContract({
      address: AAVE_POOL_BASE,
      abi: aavePoolAbi,
      functionName: "getReserveData",
      args: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
    })) as { currentLiquidityRate: bigint };
    // Aave liquidity rate is a per-second ray APR; APY = (1 + apr/secs)^secs - 1.
    const secondsPerYear = 31_536_000;
    const apr = Number(data.currentLiquidityRate) / Number(RAY);
    return (1 + apr / secondsPerYear) ** secondsPerYear - 1;
  } catch {
    return null;
  }
}

// Compound V3 supply APY from the Comet's per-second supply rate (scaled 1e18).
async function fetchCompoundApy(
  comet: `0x${string}` | undefined,
  rpcUrl: string,
): Promise<number | null> {
  if (!comet) return null;
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const utilization = (await client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "getUtilization",
    })) as bigint;
    const ratePerSecond = (await client.readContract({
      address: comet,
      abi: cometAbi,
      functionName: "getSupplyRate",
      args: [utilization],
    })) as bigint;
    const perSecond = Number(ratePerSecond) / 1e18;
    return (1 + perSecond) ** SECONDS_PER_YEAR - 1;
  } catch {
    return null;
  }
}

// Aerodrome gauge APY: (rewardRate * SECONDS_PER_YEAR * aeroPrice) / totalStakedUsd.
// AERO/USD price derived from the USDC-AERO pool's reserves on-chain.
const AERO_TOKEN = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
const USDC_AERO_POOL = "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d";

const gaugeAbi = [
  { name: "rewardRate", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "uint256" }] as const },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "uint256" }] as const },
] as const;

const poolReservesAbi = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "_reserve0", type: "uint256" }, { name: "_reserve1", type: "uint256" }, { name: "_blockTimestampLast", type: "uint256" }] as const },
  { name: "token0", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "address" }] as const },
] as const;

async function fetchAerodromeGaugeApy(
  protocol: ProtocolEntry,
  rpcUrl: string,
  poolLabel?: string,
): Promise<number | null> {
  const pools = protocol.aerodromePools ?? [];
  const defaultLabel = protocol.defaultAerodromePool;
  let targetPool: typeof pools[0] | undefined;
  if (poolLabel) {
    targetPool = pools.find((p) => p.label.toLowerCase() === poolLabel.toLowerCase());
  } else if (defaultLabel) {
    targetPool = pools.find((p) => p.label.toLowerCase() === defaultLabel.toLowerCase());
  }
  if (!targetPool) targetPool = pools[0];
  if (!targetPool) return null;

  try {
    const client = createPublicClient({ transport: http(rpcUrl) });

    // 1. Gauge metrics
    const [rewardRate, totalStaked] = await Promise.all([
      client.readContract({ address: targetPool.gauge, abi: gaugeAbi, functionName: "rewardRate" }) as Promise<bigint>,
      client.readContract({ address: targetPool.gauge, abi: gaugeAbi, functionName: "totalSupply" }) as Promise<bigint>,
    ]);

    if (totalStaked === 0n) return null;

    // 2. AERO price from USDC-AERO pool reserves
    const [reserves, token0] = await Promise.all([
      client.readContract({ address: USDC_AERO_POOL, abi: poolReservesAbi, functionName: "getReserves" }) as Promise<[bigint, bigint, bigint]>,
      client.readContract({ address: USDC_AERO_POOL, abi: poolReservesAbi, functionName: "token0" }) as Promise<string>,
    ]);

    const [reserve0, reserve1] = reserves;
    // Determine which reserve is USDC (6 dec) and which is AERO (18 dec)
    const usdcIsToken0 = token0.toLowerCase() !== AERO_TOKEN.toLowerCase();
    const usdcReserve = usdcIsToken0 ? reserve0 : reserve1;
    const aeroReserve = usdcIsToken0 ? reserve1 : reserve0;

    if (aeroReserve === 0n) return null;

    // AERO price in USDC (6 decimals) per 1 AERO (18 decimals)
    const aeroPriceNum = Number(usdcReserve) / (Number(aeroReserve) / 1e12);

    // 3. Read the TARGET pool's reserves for TVL calculation
    const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const [targetReserves, targetToken0, totalLpSupply] = await Promise.all([
      client.readContract({ address: targetPool.pool, abi: poolReservesAbi, functionName: "getReserves" }) as Promise<[bigint, bigint, bigint]>,
      client.readContract({ address: targetPool.pool, abi: poolReservesAbi, functionName: "token0" }) as Promise<string>,
      client.readContract({
        address: targetPool.pool,
        abi: [{ name: "totalSupply", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "uint256" }] as const }] as const,
        functionName: "totalSupply",
      }) as Promise<bigint>,
    ]);

    if (totalLpSupply === 0n) return null;

    // Identify the USDC side of the target pool
    const targetUsdcIsToken0 = targetToken0.toLowerCase() === USDC_ADDRESS.toLowerCase();
    const targetUsdcReserve = targetUsdcIsToken0 ? targetReserves[0] : targetReserves[1];

    // Pool TVL ≈ 2 * USDC reserve (50/50 value approximation)
    const totalPoolUsd = Number(targetUsdcReserve) * 2 / 1e6;
    const stakedFraction = Number(totalStaked) / Number(totalLpSupply);
    const stakedUsd = totalPoolUsd * stakedFraction;

    if (stakedUsd <= 0) return null;

    const annualRewardsUsd = (Number(rewardRate) / 1e18) * SECONDS_PER_YEAR * aeroPriceNum;
    const apr = annualRewardsUsd / stakedUsd;

    // Cap at 500% to reject absurd readings
    return apr >= 0 && apr <= 5 ? apr : null;
  } catch {
    return null;
  }
}


// Model-free APY for any ERC-4626 vault (e.g. Euler Earn) with no rate call or feed:
// annualize the share-price growth (convertToAssets) between now and a block ~7d ago,
// scaling by the actual elapsed time. Withheld on any read failure or non-positive/absurd result.
async function fetchErc4626OnchainApy(
  vault: `0x${string}`,
  rpcUrl: string,
): Promise<number | null> {
  try {
    const client = createPublicClient({ transport: http(rpcUrl) });
    const latest = await client.getBlock();
    const pastNumber = latest.number - SAMPLE_BLOCK_OFFSET;
    const pastBlock = await client.getBlock({ blockNumber: pastNumber });

    // Read the vault's share decimals to pick the right query input size.
    // For 18-decimal share vaults (e.g. Steakhouse Prime USDC V2 with 6-decimal
    // underlying), 10^12 truncates to 1 and loses all precision. Instead we use
    // 10^decimals which always produces a meaningful ratio. The returned value
    // (assets per 1 share) stays well within Number.MAX_SAFE_INTEGER because it
    // equals roughly 10^(underlyingDecimals) regardless of share decimals.
    const decimalsAbi = [{ name: "decimals", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "uint8" }] as const }] as const;
    let shareDecimals = 12; // fallback
    try {
      shareDecimals = (await client.readContract({
        address: vault,
        abi: decimalsAbi,
        functionName: "decimals",
      })) as number;
    } catch {
      // fallback to 12 if decimals() not available
    }
    const ONE = 10n ** BigInt(shareDecimals);

    const [now, past] = await Promise.all([
      client.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: "convertToAssets",
        args: [ONE],
      }) as Promise<bigint>,
      client.readContract({
        address: vault,
        abi: erc4626Abi,
        functionName: "convertToAssets",
        args: [ONE],
        blockNumber: pastNumber,
      }) as Promise<bigint>,
    ]);

    const elapsed = Number(latest.timestamp - pastBlock.timestamp);
    if (past === 0n || now <= past || elapsed <= 0) return null;

    const apy =
      (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
    return apy >= 0 && apy <= 2 ? apy : null; // reject absurd readings
  } catch {
    return null;
  }
}

// Pendle implied (fixed) APY — the resolved market's PT yield-to-maturity
// (falls back to the default whitelisted market when none was specified).
async function fetchPendleImpliedApy(
  protocol: ProtocolEntry,
  marketOverride?: string,
): Promise<number | null> {
  const market = marketOverride ?? protocol.defaultPendleMarket;
  if (!market) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api-v2.pendle.finance/core/v1/${8453}/markets/${market}`,
      {
        signal: controller.signal,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { impliedApy?: number };
    return typeof json.impliedApy === "number" ? json.impliedApy : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Current supply APY for a DefiLlama pool = latest chart point's base + reward APY.
async function fetchDefiLlamaApy(
  poolId: string | undefined,
): Promise<number | null> {
  if (!poolId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${DEFILLAMA_CHART}/${poolId}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status: string;
      data: { apyBase: number | null; apyReward: number | null }[];
    };
    if (json.status !== "success" || json.data.length === 0) return null;
    const latest = json.data[json.data.length - 1];
    if (latest.apyBase === null) return null;
    // DefiLlama reports percentages; convert to a fraction.
    return (latest.apyBase + (latest.apyReward ?? 0)) / 100;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Resolves the specific vault/wrapper a leg actually lands in, so the UI can
// always show it next to the protocol name — never just the umbrella brand.
// Pendle has several candidate markets (address only matters for re-fetching
// APY off the right one); every other protocol here is a single fixed vault,
// so its registered `vaultSymbol` is shown unconditionally.
function resolveLegVault(
  protocol: ProtocolEntry,
  pendleMarketRef?: string,
): { address?: string; label: string } | undefined {
  const markets = protocol.pendleVaultMarkets;
  const fallback = protocol.defaultPendleMarket;
  if (markets && fallback) {
    const byDefault = markets.find(
      (m) => m.market.toLowerCase() === fallback.toLowerCase(),
    );
    if (!pendleMarketRef) {
      return byDefault
        ? { address: byDefault.market, label: byDefault.label }
        : { address: fallback, label: fallback };
    }

    const byAddr = markets.find(
      (m) => m.market.toLowerCase() === pendleMarketRef.toLowerCase(),
    );
    if (byAddr) return { address: byAddr.market, label: byAddr.label };

    const n = norm(pendleMarketRef);
    const byLabel = markets.find((m) => n.includes(norm(m.label)));
    if (byLabel) return { address: byLabel.market, label: byLabel.label };
    return byDefault
      ? { address: byDefault.market, label: byDefault.label }
      : { address: fallback, label: fallback };
  }

  // The position token (when the registry has one, e.g. CompoundV3's Comet
  // ERC-20) is the address that actually represents the user's balance;
  // otherwise the protocol's own address is the vault.
  return protocol.vaultSymbol
    ? { address: protocol.positionToken ?? protocol.address, label: protocol.vaultSymbol }
    : undefined;
}

// Computes the blended deposit APY across allocation legs. Net APY is the bps-weighted
// average and is withheld (null) if any leg's rate is unavailable — never fabricated.
export async function computeDepositApy(
  allocations: { protocol: string; bps: number; pendleMarket?: string; aerodromePool?: string }[],
  config: EvmChainConfig,
  redis?: Redis,
): Promise<DepositApy> {
  const legs = await Promise.all(
    allocations.map(async (a): Promise<DepositLeg> => {
      const protocol = resolveProtocolEntry(config.protocols, a.protocol);
      const resolvedMarket = protocol
        ? resolveLegVault(protocol, a.pendleMarket)
        : undefined;
      const apy = protocol
        ? await fetchProtocolApy(protocol, config.rpcUrl, redis, resolvedMarket?.address, a.aerodromePool)
        : null;
      return {
        protocol: a.protocol,
        bps: a.bps,
        apy,
        status: apy === null ? "unavailable" : "ok",
        market: resolvedMarket?.label,
        marketAddress: resolvedMarket?.address,
      };
    }),
  );

  const allOk = legs.every((l) => l.status === "ok");
  const anyOk = legs.some((l) => l.status === "ok");
  const netApy = allOk
    ? legs.reduce((sum, l) => sum + (l.apy as number) * l.bps, 0) / 10000
    : null;

  return {
    status: allOk ? "ok" : anyOk ? "partial" : "unavailable",
    netApy,
    legs,
  };
}

// Reads whatever the warmer (vault-apy-warmer.ts) has already put in Redis —
// a pure cache read, no live network call, so this is safe to run on every
// prompt assembly with no added latency and no rate-limit exposure. A
// protocol with no cached value yet (warmer hasn't run, or every source
// failed) is left out entirely rather than shown with a guessed rate.
export async function readCachedProtocolApys(
  protocols: ProtocolEntry[],
  redis: Redis,
): Promise<{ name: string; apy: number }[]> {
  const entries = await Promise.all(
    protocols
      .filter((p) => p.apySource !== "none")
      .map(async (p) => {
        const key = vaultApyCacheKey(p, p.defaultPendleMarket);
        const cached = await redis.get(key).catch(() => null);
        return cached !== null ? { name: p.name, apy: Number(cached) } : null;
      }),
  );
  return entries.filter((e): e is { name: string; apy: number } => e !== null);
}
