import type pg from "pg";
import type { Redis } from "ioredis";
import type { ApyAdapter, Market, Protocol } from "../types.js";
import { getEnabledMarkets, upsertRates } from "../db/queries.js";
import { setCachedRates } from "../cache/redis.js";
import { withRetry } from "./retry.js";

type PollerDeps = {
  pool: pg.Pool;
  redis: Redis;
  adapters: Map<Protocol, ApyAdapter>;
  intervalMs: number;
};

type PollerState = {
  lastPollAt: string | null;
  marketsPolled: number;
  failedMarkets: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
// "protocol:chainId" keys already reported as unserviceable — see poll().
const warnedUnsupported = new Set<string>();
let state: PollerState = { lastPollAt: null, marketsPolled: 0, failedMarkets: 0 };

export function getPollerState(): PollerState {
  return { ...state };
}

export function startPoller(deps: PollerDeps): void {
  poll(deps);
  timer = setInterval(() => poll(deps), deps.intervalMs);
}

export function stopPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function poll(deps: PollerDeps): Promise<void> {
  const { pool, redis, adapters } = deps;

  let markets: Market[];
  try {
    markets = await getEnabledMarkets(pool);
  } catch (err) {
    console.error("[apy-poller] Failed to load markets:", err);
    return;
  }

  const grouped = groupByProtocolAndChain(markets);
  let polled = 0;
  let failed = 0;

  for (const [key, batch] of grouped) {
    const [protocol, chainIdStr] = key.split(":");
    const chainId = parseInt(chainIdStr, 10);
    const adapter = adapters.get(protocol as Protocol);

    if (!adapter) {
      failed += batch.length;
      continue;
    }

    // A chain the adapter has no configuration for is a permanent condition,
    // not a flaky call — retrying it every tick just prints the same stack
    // trace forever. This is what stale market_registry rows from a previous
    // chain look like (see migration 009_monad_markets.sql); warn once per
    // process so the cause is visible, then stay quiet.
    if (adapter.supportsChain && !adapter.supportsChain(chainId)) {
      if (!warnedUnsupported.has(key)) {
        warnedUnsupported.add(key);
        console.warn(
          `[apy-poller] Skipping ${batch.length} market(s) for "${key}" — ` +
          `the ${protocol} adapter has no configuration for chain ${chainId}. ` +
          `If these are rows from a previous chain, run: npm run migrate`,
        );
      }
      failed += batch.length;
      continue;
    }

    try {
      const ratesMap = await withRetry(() => adapter.getRatesBatch(batch, chainId));

      for (const market of batch) {
        const rates = ratesMap.get(market.marketId);
        if (!rates) {
          failed++;
          continue;
        }

        const stored = { ...rates, updatedAt: new Date().toISOString() };

        await upsertRates(pool, market.marketId, rates);
        await setCachedRates(redis, market.marketId, stored);
        polled++;
      }
    } catch (err) {
      console.error(`[apy-poller] Batch failed for ${key}:`, err);
      failed += batch.length;
    }
  }

  state = {
    lastPollAt: new Date().toISOString(),
    marketsPolled: polled,
    failedMarkets: failed,
  };
}

function groupByProtocolAndChain(markets: Market[]): Map<string, Market[]> {
  const map = new Map<string, Market[]>();
  for (const m of markets) {
    const key = `${m.protocol}:${m.chainId}`;
    const group = map.get(key) ?? [];
    group.push(m);
    map.set(key, group);
  }
  return map;
}
