import type { Redis } from "ioredis";
import type { StoredPosition } from "./types.js";

const KEY_PREFIX = "positions:";
const LOCK_PREFIX = "positions:lock:";
const LOCK_TTL_SECONDS = 15;

export async function getCachedPositions(
  redis: Redis,
  wallet: string,
): Promise<StoredPosition[] | null> {
  const raw = await redis.get(`${KEY_PREFIX}${wallet.toLowerCase()}`);
  if (!raw) return null;
  return JSON.parse(raw) as StoredPosition[];
}

export async function setCachedPositions(
  redis: Redis,
  wallet: string,
  positions: StoredPosition[],
  ttlSeconds: number,
): Promise<void> {
  await redis.set(
    `${KEY_PREFIX}${wallet.toLowerCase()}`,
    JSON.stringify(positions),
    "EX",
    ttlSeconds,
  );
}

// SET NX lock so concurrent discovery for the same wallet runs once. Returns true if acquired.
export async function acquireDiscoveryLock(
  redis: Redis,
  wallet: string,
): Promise<boolean> {
  const res = await redis.set(
    `${LOCK_PREFIX}${wallet.toLowerCase()}`,
    "1",
    "EX",
    LOCK_TTL_SECONDS,
    "NX",
  );
  return res === "OK";
}

export async function releaseDiscoveryLock(
  redis: Redis,
  wallet: string,
): Promise<void> {
  await redis.del(`${LOCK_PREFIX}${wallet.toLowerCase()}`);
}
