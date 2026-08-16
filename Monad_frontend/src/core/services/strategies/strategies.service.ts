import type pg from "pg";
import type { Orchestrator } from "../../orchestrator.js";
import type { EvmKernel } from "@chains/evm/kernel.js";
import {
  type ApyResolverPort,
  type StrategyLeg,
  type StrategyLegRates,
} from "../apy/types.js";
import { FortressLogger } from "@shared/logger.js";
import { aggregateStrategyApy } from "@chains/evm/execution/apy.js";
import { STRATEGY_CATALOG, PREVIEW_WALLET } from "./catalog.js";
import {
  upsertCatalogMeta,
  saveStrategyBuild,
  saveStrategyBuildError,
  saveStrategyRates,
  getAllStrategies,
  getSeededStrategies,
  type StoredStrategy,
} from "./db.js";

export type StrategyListItem = {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  status: "ok" | "unavailable" | "error" | "pending";
  description: string | null;
  leverage: number | null;
  netApy: number | null;
  collateralApy: number | null;
  borrowApy: number | null;
  error: string | null;
  updatedAt: string;
};

export type StrategiesResponse = {
  strategies: StrategyListItem[];
  asOf: string;
};

export class StrategiesService {
  private readonly pool: pg.Pool;
  private readonly orchestrator: Orchestrator;
  private readonly kernel: EvmKernel;
  private readonly apyResolver?: ApyResolverPort;
  private readonly chainId: number;

  constructor(deps: {
    pool: pg.Pool;
    orchestrator: Orchestrator;
    kernel: EvmKernel;
    apyResolver?: ApyResolverPort;
    chainId: number;
  }) {
    this.pool = deps.pool;
    this.orchestrator = deps.orchestrator;
    this.kernel = deps.kernel;
    this.apyResolver = deps.apyResolver;
    this.chainId = deps.chainId;
  }

  // Read path: serve the persisted catalog. Never hits the planner/LiFi — those run
  // once at seed time. Net APY stays current because the poller refreshes rate columns.
  async list(): Promise<StrategiesResponse> {
    const rows = await getAllStrategies(this.pool);
    return {
      strategies: rows.map(toListItem),
      asOf: new Date().toISOString(),
    };
  }

  // One-time structural build per catalog entry: planner → strategy build → projection.
  // Stores leverage + the rate-resolution keys (collateral token, borrow market). This
  // is the "simulate once" step. Idempotent: meta is upserted, build saved on success.
  async seed(): Promise<void> {
    for (const entry of STRATEGY_CATALOG) {
      await upsertCatalogMeta(this.pool, {
        id: entry.id,
        chainId: this.chainId,
        title: entry.title,
        summary: entry.summary,
        prompt: entry.prompt,
      });

      const log = FortressLogger.newRequest().at({
        route: "GET /fortress/strategies",
        file: "strategies.service.ts",
        fn: "seed",
      });
      try {
        const { description, apy } = await this.orchestrator.previewStrategy(
          entry.prompt,
          "base",
          PREVIEW_WALLET,
          log,
        );
        await saveStrategyBuild(this.pool, {
          id: entry.id,
          description,
          leverage: apy?.leverage ?? null,
          collateralToken: apy?.collateralToken ?? null,
          borrowMarketKey: apy?.borrowMarketKey ?? null,
          snapshot: apy?.snapshot ?? null,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("STRATEGY_SEED_FAILED", err);
        await saveStrategyBuildError(this.pool, entry.id, message);
      }
    }
  }

  // Poller entry point: re-price every seeded strategy from FRESH market rates using
  // the persisted per-leg snapshot. Runs the SAME aggregator the live plan path uses,
  // so leverage/net APY can never drift between the two.
  async refreshRates(): Promise<void> {
    if (!this.apyResolver) return;
    const rows = await getSeededStrategies(this.pool);
    await Promise.all(rows.map((s) => this.refreshOne(s)));
  }

  private async refreshOne(s: StoredStrategy): Promise<void> {
    if (!this.apyResolver || !s.snapshot) return;

    // Resolve fresh rates for each leg. Cache staking lookups per collateral token.
    const stakingCache = new Map<
      string,
      Awaited<ReturnType<ApyResolverPort["resolve"]>>
    >();
    const legs: Array<StrategyLeg & StrategyLegRates> = [];

    for (const leg of s.snapshot.legs) {
      const borrow =
        leg.debtValue > 0
          ? await this.apyResolver.resolve({
            kind: "morpho",
            chainId: s.chainId,
            marketKey: leg.marketKeyHash as `0x${string}`,
            name: `${leg.collateralToken}/borrow`,
          })
          : null;

      let collateral: Awaited<ReturnType<ApyResolverPort["resolve"]>> | null =
        null;
      if (leg.collateralValue > 0) {
        const key = leg.collateralToken.toLowerCase();
        collateral =
          stakingCache.get(key) ??
          (await this.apyResolver.resolve({
            kind: "staking",
            chainId: s.chainId,
            token: leg.collateralToken,
            name: `${leg.collateralToken} staking`,
          }));
        stakingCache.set(key, collateral);
      }

      legs.push({
        ...leg,
        collateralApy: collateral?.rates?.supplyApy ?? null,
        collateralStatus: collateral?.status ?? "ok",
        borrowApy: borrow?.rates?.borrowApy ?? null,
        borrowStatus: borrow?.status ?? "ok",
        rewardsApy: borrow?.rates?.rewardsApy ?? 0,
      });
    }

    const agg = aggregateStrategyApy(legs, s.snapshot.idleCash);

    console.log(
      `[strategies:apy] ${s.id} legs=${legs.length} idleCash=${s.snapshot.idleCash} ` +
      `equity=${agg.equity.toFixed(4)} lev=${agg.leverage.toFixed(2)}x ` +
      `collBlend=${fmtPct(agg.collateralApy)} borrowBlend=${fmtPct(agg.borrowApy)} ` +
      `net=${fmtPct(agg.netApy)} [${agg.status}]`,
    );

    await saveStrategyRates(this.pool, {
      id: s.id,
      netApy: agg.netApy,
      collateralApy: agg.collateralApy,
      borrowApy: agg.borrowApy,
      leverage: agg.leverage,
      rateStatus: agg.status,
    });
  }
}

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${(v * 100).toFixed(2)}%`;
}

function toListItem(s: StoredStrategy): StrategyListItem {
  const status: StrategyListItem["status"] = s.buildError
    ? "error"
    : !s.seeded
      ? "pending"
      : s.rateStatus === "ok"
        ? "ok"
        : "unavailable";

  return {
    id: s.id,
    title: s.title,
    summary: s.summary,
    prompt: s.prompt,
    status,
    description: s.description,
    leverage: s.leverage,
    netApy: s.netApy,
    collateralApy: s.collateralApy,
    borrowApy: s.borrowApy,
    error: s.buildError,
    updatedAt: s.updatedAt,
  };
}
