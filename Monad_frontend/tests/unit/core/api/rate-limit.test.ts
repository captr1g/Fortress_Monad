import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRateLimiter } from "@core/api/middleware/rate-limit.js";
import type { FastifyReply, FastifyRequest } from "fastify";

// Minimal Fastify reply double that records the status + payload and chains.
function makeReply() {
  const state: { status?: number; payload?: unknown } = {};
  const reply = {
    status(code: number) {
      state.status = code;
      return reply;
    },
    send(payload: unknown) {
      state.payload = payload;
      return reply;
    },
  } as unknown as FastifyReply;
  return { reply, state };
}

const req = (ip: string) => ({ ip }) as unknown as FastifyRequest;

describe("createRateLimiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("allows requests up to the limit and calls done()", () => {
    const limit = createRateLimiter(3, 1000);
    for (let i = 0; i < 3; i++) {
      const done = vi.fn();
      const { reply, state } = makeReply();
      limit(req("1.1.1.1"), reply, done);
      expect(done).toHaveBeenCalledOnce();
      expect(state.status).toBeUndefined();
    }
  });

  it("rejects the request that exceeds the limit with 429 and does not call done()", () => {
    const limit = createRateLimiter(2, 1000);
    const ip = "2.2.2.2";
    limit(req(ip), makeReply().reply, vi.fn());
    limit(req(ip), makeReply().reply, vi.fn());

    const done = vi.fn();
    const { reply, state } = makeReply();
    limit(req(ip), reply, done);

    expect(state.status).toBe(429);
    expect(state.payload).toMatchObject({ error: { stage: "api", message: "Too many requests" } });
    expect(done).not.toHaveBeenCalled();
  });

  it("tracks limits independently per IP", () => {
    const limit = createRateLimiter(1, 1000);
    const a = vi.fn();
    const b = vi.fn();
    limit(req("10.0.0.1"), makeReply().reply, a);
    limit(req("10.0.0.2"), makeReply().reply, b);
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("slides the window: old hits expire and free up capacity", () => {
    const limit = createRateLimiter(1, 1000);
    const ip = "3.3.3.3";

    const first = vi.fn();
    limit(req(ip), makeReply().reply, first);
    expect(first).toHaveBeenCalledOnce();

    // Immediately over the limit.
    const blocked = makeReply();
    limit(req(ip), blocked.reply, vi.fn());
    expect(blocked.state.status).toBe(429);

    // Advance past the window; the old timestamp is pruned.
    vi.advanceTimersByTime(1001);
    const afterWindow = vi.fn();
    const okReply = makeReply();
    limit(req(ip), okReply.reply, afterWindow);
    expect(afterWindow).toHaveBeenCalledOnce();
    expect(okReply.state.status).toBeUndefined();
  });

  it("falls back to an 'unknown' bucket when ip is empty", () => {
    const limit = createRateLimiter(1, 1000);
    limit({ ip: "" } as unknown as FastifyRequest, makeReply().reply, vi.fn());
    const blocked = makeReply();
    limit({ ip: "" } as unknown as FastifyRequest, blocked.reply, vi.fn());
    expect(blocked.state.status).toBe(429);
  });
});
