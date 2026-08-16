import type pg from "pg";
import type { Redis } from "ioredis";
import type { ApyResolver } from "../apy/resolver.js";
import { computeNetApy } from "@chains/evm/execution/apy.js";
import { discoverWalletMarkets } from "./discovery.js";
import { readPositionsBatch } from "./multicall.js";
import {
  upsertTrackedWallet,
  replaceWalletPositions,
  getWalletPositions,
} from "./db.js";
import {
  getCachedPositions,
  setCachedPositions,
  acquireDiscoveryLock,
  releaseDiscoveryLock,
} from "./cache.js";
import type {
  StoredPosition,
  PositionsResponse,
  DiscoveredMarket,
} from "./types.js";
import { Address } from "viem";
import type { AnalyticsService } from "../analytics/index.js";

export type PositionsDeps = {
  pool: pg.Pool;
  redis: Redis;
  rpcUrl: string;
  morphoBlue: Address;
  chainId: number;
  cacheTtlSeconds: number;
  staleMs: number;
  apyResolver?: ApyResolver;
  analytics?: AnalyticsService;
};

export class PositionsService {
  constructor(private readonly deps: PositionsDeps) { }

  // Read path: Redis → Postgres → (unknown wallet) discover. Never hits upstream
  // for a known, cached wallet. Flags `stale` when the freshest row is older than staleMs.
  async getPositions(wallet: string): Promise<PositionsResponse> {
    const w = wallet.toLowerCase();

    const cached = await getCachedPositions(this.deps.redis, w);
    if (cached) return this.toResponse(cached);

    const stored = await getWalletPositions(this.deps.pool, w);
    if (stored.length > 0) {
      await setCachedPositions(
        this.deps.redis,
        w,
        stored,
        this.deps.cacheTtlSeconds,
      );
      return this.toResponse(stored);
    }

    // Unknown wallet: discover once, seed, return.
    const fresh = await this.refresh(w);
    return this.toResponse(fresh);
  }

  // Force discovery + on-chain read + write-through. Called on first touch and after
  // an entry/exit tx confirms. Deduped by a Redis lock so concurrent calls run once.
  //
  // Merges TWO market sources to eliminate indexer lag:
  //   1. DB-known markets (oracle/irm/lltv persisted from prior reads) — ensures
  //      existing positions are ALWAYS re-read on-chain, even if Morpho's GraphQL
  //      indexer lags behind the latest block. Covers exits (zeroed out → removed)
  //      and deleverages (updated figures) instantly.
  //   2. Freshly discovered markets from the indexer — catches brand-new positions
  //      once the indexer has indexed them (typically 3–10s after the tx confirms).
  //
  // After the on-chain read, positions with zero collateral AND zero debt are
  // filtered out so fully-closed positions disappear immediately.
  async refresh(wallet: string): Promise<StoredPosition[]> {
    const w = wallet.toLowerCase();
    await upsertTrackedWallet(this.deps.pool, w, this.deps.chainId);

    const locked = await acquireDiscoveryLock(this.deps.redis, w);
    if (!locked) {
      // Another refresh is in flight; serve what we have.
      const existing = await getWalletPositions(this.deps.pool, w);
      return existing;
    }

    try {
      // Source 1: markets we already know about from prior reads (DB).
      const dbPositions = await getWalletPositions(this.deps.pool, w);
      const dbMarkets: DiscoveredMarket[] = dbPositions.map((p) => ({
        marketKey: p.marketKey as `0x${string}`,
        params: {
          loanToken: p.loanToken as `0x${string}`,
          collateralToken: p.collateralToken as `0x${string}`,
          oracle: p.oracle as `0x${string}`,
          irm: p.irm as `0x${string}`,
          lltv: BigInt(p.lltvWad),
        },
      }));

      // Source 2: fresh discovery from Morpho's indexer (may lag).
      const discovered = await discoverWalletMarkets(w, this.deps.chainId);

      // Merge: deduplicate by marketKey, preferring discovered params (latest).
      const seen = new Set<string>();
      const merged: DiscoveredMarket[] = [];
      for (const m of discovered) {
        seen.add(m.marketKey.toLowerCase());
        merged.push(m);
      }
      for (const m of dbMarkets) {
        if (!seen.has(m.marketKey.toLowerCase())) {
          merged.push(m);
        }
      }

      // Read ALL merged markets on-chain in a single multicall batch.
      const allPositions = await this.readAndEnrich(w as Address, merged);

      // Filter out fully-closed positions (collateral=0 AND debt=0) so they
      // disappear from the portfolio immediately after an exit.
      const active = allPositions.filter(
        (p) => p.collateral !== "0" || p.debt !== "0",
      );

      await replaceWalletPositions(this.deps.pool, w, active);
      await setCachedPositions(
        this.deps.redis,
        w,
        active,
        this.deps.cacheTtlSeconds,
      );

      // A wallet going from no positions to some positions IS a deploy — the
      // on-chain state is the receipt, so this needs no tx hash and can't be
      // faked by a client. refresh() is the only place it can be observed: the
      // poller calls refreshFromMarkets(), which by construction only runs for
      // wallets that already hold positions.
      if (dbPositions.length === 0 && active.length > 0) {
        await this.deps.analytics?.record("position_opened", w, {
          chainId: this.deps.chainId,
          markets: active.length,
        });
      }

      return active;
    } finally {
      await releaseDiscoveryLock(this.deps.redis, w);
    }
  }

  // Re-reads on-chain figures for an already-discovered wallet (used by the poller,
  // which already knows the markets and skips GraphQL).
  async refreshFromMarkets(
    wallet: Address,
    markets: DiscoveredMarket[],
  ): Promise<StoredPosition[]> {
    const positions = await this.readAndEnrich(wallet, markets);
    await replaceWalletPositions(this.deps.pool, wallet, positions);
    await setCachedPositions(
      this.deps.redis,
      wallet,
      positions,
      this.deps.cacheTtlSeconds,
    );
    return positions;
  }

  private async readAndEnrich(
    wallet: Address,
    markets: DiscoveredMarket[],
  ): Promise<StoredPosition[]> {
    const base = await readPositionsBatch(
      this.deps.rpcUrl,
      this.deps.morphoBlue,
      wallet,
      markets,
    );

    const now = new Date().toISOString();
    return Promise.all(
      base.map(async (p) => ({
        ...p,
        netApy: await this.computeNetApy(p),
        updatedAt: now,
      })),
    );
  }

  // Net APY on the wallet's equity: leveraged collateral yield minus borrow cost.
  // Withheld (null) unless both rate terms resolve fresh — never fabricated.
  private async computeNetApy(
    p: Omit<StoredPosition, "netApy" | "updatedAt">,
  ): Promise<number | null> {
    if (!this.deps.apyResolver) return null;

    const borrow = await this.deps.apyResolver.resolve({
      kind: "morpho",
      chainId: this.deps.chainId,
      marketKey: p.marketKey as Address,
      name: `${p.collateralToken}/${p.loanToken}`,
    });
    const collateral = await this.deps.apyResolver.resolve({
      kind: "staking",
      chainId: this.deps.chainId,
      token: p.collateralToken as Address,
      name: `${p.collateralToken} staking`,
    });

    const borrowApy = borrow.rates?.borrowApy;
    const collateralApy = collateral.rates?.supplyApy;
    if (borrow.status !== "ok" || collateral.status !== "ok") return null;
    if (
      borrowApy === null ||
      borrowApy === undefined ||
      collateralApy === undefined
    ) {
      return null;
    }

    const collateralValue = Number(p.collateralValue);
    const debtValue = Number(p.debt);
    const equity = collateralValue - debtValue;
    if (equity <= 0) return null;

    return computeNetApy({
      equity,
      collateralValue,
      debtValue,
      collateralApy,
      borrowApy,
      rewardsApy: borrow.rates?.rewardsApy ?? 0,
    });
  }

  private toResponse(positions: StoredPosition[]): PositionsResponse {
    const asOf =
      positions.length > 0
        ? positions.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b))
          .updatedAt
        : null;
    const stale =
      asOf === null
        ? false
        : Date.now() - new Date(asOf).getTime() > this.deps.staleMs;
    return { positions, asOf, stale };
  }
}
