import { describe, it, expect, vi } from "vitest";
import type { Redis } from "ioredis";
import type { FastifyRequest, FastifyReply } from "fastify";
import { createAdminMiddleware } from "@core/services/auth/middleware.js";

const ADMIN = "0xAAaAaAaAaAAAaaAAAAAaaAaAAaAAaaaAaAaAaAaA";
const OUTSIDER = "0xBbBbbBBbBbbBBbBBbbBbbbBBBbbBBBBbBbbBBBbB";

function fakeRedis(sessions: Record<string, string>): Redis {
  return {
    get: vi.fn(async (key: string) => sessions[key] ?? null),
  } as unknown as Redis;
}

function fakeReply() {
  const reply = {
    statusCode: 0,
    payload: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(body: unknown) {
      reply.payload = body;
      return reply;
    },
  };
  return reply;
}

function requestWithToken(token?: string): FastifyRequest {
  return { cookies: token ? { auth_token: token } : {} } as unknown as FastifyRequest;
}

const session = (wallet: string) => JSON.stringify({ walletAddress: wallet.toLowerCase() });

describe("createAdminMiddleware", () => {
  it("admits a session whose wallet is on the allowlist", async () => {
    const redis = fakeRedis({ "session:tok": session(ADMIN) });
    const middleware = createAdminMiddleware(redis, [ADMIN]);
    const request = requestWithToken("tok");
    const reply = fakeReply();

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(0);
    expect(request.walletAddress).toBe(ADMIN.toLowerCase());
  });

  it("matches the allowlist case-insensitively", async () => {
    const redis = fakeRedis({ "session:tok": session(ADMIN) });
    // Configured checksummed, session stores lowercase — these must be one wallet.
    const middleware = createAdminMiddleware(redis, [ADMIN.toUpperCase()]);
    const reply = fakeReply();

    await middleware(requestWithToken("tok"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(0);
  });

  // 404 rather than 403: a signed-in non-admin should not learn the route exists.
  it("hides the route from a signed-in wallet that is not allowlisted", async () => {
    const redis = fakeRedis({ "session:tok": session(OUTSIDER) });
    const middleware = createAdminMiddleware(redis, [ADMIN]);
    const request = requestWithToken("tok");
    const reply = fakeReply();

    await middleware(request, reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(404);
    expect(request.walletAddress).toBeUndefined();
  });

  // The failure mode of a misconfigured admin route must be "nobody gets in".
  it("denies everyone when the allowlist is empty", async () => {
    const redis = fakeRedis({ "session:tok": session(ADMIN) });
    const middleware = createAdminMiddleware(redis, []);
    const reply = fakeReply();

    await middleware(requestWithToken("tok"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(404);
  });

  it("rejects a request with no session cookie", async () => {
    const middleware = createAdminMiddleware(fakeRedis({}), [ADMIN]);
    const reply = fakeReply();

    await middleware(requestWithToken(), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(401);
  });

  it("rejects a cookie whose session no longer exists", async () => {
    const middleware = createAdminMiddleware(fakeRedis({}), [ADMIN]);
    const reply = fakeReply();

    await middleware(requestWithToken("stale"), reply as unknown as FastifyReply);

    expect(reply.statusCode).toBe(401);
  });
});
