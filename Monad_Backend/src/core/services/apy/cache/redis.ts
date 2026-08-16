import { Redis } from "ioredis";
import type { StoredRates } from "../types.js";

const CACHE_TTL_SECONDS = 120;
const KEY_PREFIX = "apy:";
const CONNECT_TIMEOUT_MS = 15_000;

// The app must work against both a standalone Redis (local docker dev) and a
// sharded cluster (e.g. Azure Managed Redis, which answers single-node
// commands but replies MOVED for keys owned by other shards). We therefore
// try the cluster client first and fall back to standalone. Everything —
// host, port, password, TLS — comes from the connection URL.
export type RedisClient = Redis;

let client: Redis | null = null;

function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password?: string;
  tls?: { servername: string };
} {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    // "rediss://" = TLS. servername is required because the cluster client
    // connects to nodes by resolved IP, and the certificate is issued for
    // the hostname — without it TLS verification fails with
    // ERR_TLS_CERT_ALTNAME_INVALID.
    tls: parsed.protocol === "rediss:" ? { servername: parsed.hostname } : undefined,
  };
}

function waitReady(instance: Redis, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Redis connect timeout")),
      timeoutMs,
    );
    instance.once("ready", () => {
      clearTimeout(timer);
      resolve();
    });
    instance.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function createClient(url: string): Promise<Redis> {
  const { host, port, password, tls } = parseRedisUrl(url);

  let cluster: Redis | null = null;
  try {
    // Cluster client. Cast: the command surface used by this codebase
    // (get/set/del/incr/expire/quit) is identical on Redis and Redis.Cluster.
    cluster = new Redis.Cluster([{ host, port }], {
      redisOptions: { password, tls },
      scaleReads: "all",
    }) as unknown as Redis;
    await waitReady(cluster, 3000);
    console.log(`[redis] Connected to cluster at ${host}:${port}`);
    return cluster;
  } catch (err) {
    if (cluster) {
      try {
        (cluster as unknown as { disconnect: () => void }).disconnect();
      } catch {}
    }
    console.warn(
      `[redis] Cluster connect skipped (${(err as Error)?.message ?? err}); using standalone Redis`,
    );
  }

  const standalone = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
  standalone.on("error", (err) => {
    console.warn(`[redis:standalone] Error: ${(err as Error)?.message ?? err}`);
  });
  await standalone.connect();
  console.log(`[redis] Connected to standalone Redis at ${host}:${port}`);
  return standalone;
}

export function getRedis(url: string): Redis {
  if (!client) {
    throw new Error("Redis not initialized — call connectRedis first");
  }
  return client;
}

export async function connectRedis(url: string): Promise<Redis> {
  if (!client) {
    client = await createClient(url);
  }
  return client;
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
