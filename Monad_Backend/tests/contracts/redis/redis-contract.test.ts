import { describe, it, expect, afterAll } from "vitest";
import { Redis } from "ioredis";
import { describeIntegration, hasEnv } from "../../helpers/integration.js";

// Contract: the configured Redis accepts the ping/set-with-EX/get/del operations
// the APY cache and auth session layers rely on. Uses a namespaced throwaway key
// and cleans it up, so it never touches real apy:/session:/nonce: data.

let redis: Redis | undefined;

describeIntegration("contract: Redis (APY_REDIS_URL)", () => {
  afterAll(async () => {
    if (redis) await redis.quit();
  });

  it.skipIf(!hasEnv("APY_REDIS_URL"))(
    "pings and round-trips a namespaced key with TTL",
    async () => {
      redis = new Redis(process.env.APY_REDIS_URL!, { maxRetriesPerRequest: 3 });
      const key = `fortress:contracttest:${Date.now()}`;

      expect(await redis.ping()).toBe("PONG");

      await redis.set(key, JSON.stringify({ ok: true }), "EX", 30);
      const raw = await redis.get(key);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({ ok: true });

      const ttl = await redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);

      await redis.del(key);
      expect(await redis.get(key)).toBeNull();
    },
  );
});
