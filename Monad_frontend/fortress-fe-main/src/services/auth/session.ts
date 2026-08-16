import crypto from "node:crypto";
import { Redis } from "ioredis";

const NONCE_TTL = 300; // 5 minutes
const SESSION_TTL = 604800; // 7 days

let redisClient: Redis | null = null;

export function getAuthRedis(url: string): Redis {
  if (!redisClient) {
    redisClient = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  }
  return redisClient;
}

export async function createNonce(redis: Redis, address: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString("hex");
  const key = `nonce:${address.toLowerCase()}`;
  await redis.set(key, nonce, "EX", NONCE_TTL);
  return nonce;
}

export async function getNonce(redis: Redis, address: string): Promise<string | null> {
  const key = `nonce:${address.toLowerCase()}`;
  const nonce = await redis.get(key);
  if (nonce) {
    await redis.del(key);
  }
  return nonce;
}

export async function createSession(redis: Redis, walletAddress: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const key = `session:${sessionId}`;
  const payload = JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    createdAt: Date.now(),
  });
  await redis.set(key, payload, "EX", SESSION_TTL);
  return sessionId;
}

export async function getSession(
  redis: Redis,
  token: string
): Promise<{ walletAddress: string } | null> {
  const key = `session:${token}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  const data = JSON.parse(raw) as { walletAddress: string; createdAt: number };
  return { walletAddress: data.walletAddress };
}

export async function deleteSession(redis: Redis, token: string): Promise<void> {
  const key = `session:${token}`;
  await redis.del(key);
}
