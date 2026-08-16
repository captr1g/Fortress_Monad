import { Redis } from "ioredis";
import type { StoredRates } from "../types.js";

const CACHE_TTL_SECONDS = 120;
const KEY_PREFIX = "apy:";

let client: Redis | null = null;

export function getRedis(url: string): Redis {
  if (!client) {
    client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  }
  return client;
}

export async function connectRedis(url: string): Promise<Redis> {
  const redis = getRedis(url);
  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

export async function getCachedRates(
  redis: Redis,
  marketId: string,
): Promise<StoredRates | null> {
  const raw = await redis.get(`${KEY_PREFIX}${marketId}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredRates;
}

export async function setCachedRates(
  redis: Redis,
  marketId: string,
  rates: StoredRates,
): Promise<void> {
  await redis.set(
    `${KEY_PREFIX}${marketId}`,
    JSON.stringify(rates),
    "EX",
    CACHE_TTL_SECONDS,
  );
}

export async function deleteCachedRates(
  redis: Redis,
  marketId: string,
): Promise<void> {
  await redis.del(`${KEY_PREFIX}${marketId}`);
}
