import type { Redis } from "ioredis";
import type { EvmChainConfig } from "@chains/evm/types.js";
import { fetchProtocolApy } from "./vault-apy.js";

// Keeps the deposit-protocol APY cache (vault-apy.ts's Redis keys) warm on a
// fixed interval, independent of any user request. computeDepositApy already
// checks-then-fetches-then-caches this same cache lazily, on whatever
// protocol a real deposit preview happens to touch — this just makes sure
// every registered protocol has a fresh entry sitting there already,
// including ones nobody has previewed recently, so:
//   1. the planner can read current rates at prompt-assembly time via
//      readCachedProtocolApys() with a plain Redis GET, never a live call
//      on the user's clock, and never at risk of a source's rate limit.
//   2. a user's first deposit preview into a cold protocol doesn't pay for
//      the live fetch itself.
// A failed source just means that protocol's key doesn't get refreshed this
// tick (fetchProtocolApy returns null and caches nothing on failure) — it
// falls back to whatever's still live under the existing 120s TTL, not a
// fabricated number.
export function startVaultApyWarmer(deps: {
  config: EvmChainConfig;
  redis: Redis;
  intervalMs: number;
}): void {
  const { config, redis, intervalMs } = deps;
  const targets = config.protocols.filter((p) => p.apySource !== "none");

  async function tick(): Promise<void> {
    const calls: Promise<number | null>[] = [];
    for (const p of targets) {
      if (p.apySource === "aerodrome-gauge" && p.aerodromePools) {
        // Warm each Aerodrome pool independently
        for (const pool of p.aerodromePools) {
          calls.push(fetchProtocolApy(p, config.rpcUrl, redis, undefined, pool.label));
        }
      } else {
        calls.push(fetchProtocolApy(p, config.rpcUrl, redis, p.defaultPendleMarket));
      }
    }
    const results = await Promise.allSettled(calls);
    const warmed = results.filter((r) => r.status === "fulfilled" && r.value !== null).length;
    console.log(`[vault-apy-warmer] warmed ${warmed}/${calls.length} protocol rates`);
  }

  tick();
  setInterval(tick, intervalMs);
}
