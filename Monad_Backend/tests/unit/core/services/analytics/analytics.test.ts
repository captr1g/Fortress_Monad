import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type pg from "pg";
import { AnalyticsService } from "@core/services/analytics/analytics.service.js";

const WALLET = "0x1111111111111111111111111111111111111111";

describe("AnalyticsService", () => {
  const makePool = (query: pg.Pool["query"]) => ({ query }) as unknown as pg.Pool;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lowercases the wallet before writing it", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AnalyticsService({ pool: makePool(query) });
    const checksummed = "0xAbC1111111111111111111111111111111111111";

    await service.recordSignIn(checksummed);

    const params = query.mock.calls.flatMap((call) => call[1] ?? []);
    expect(params).toContain(checksummed.toLowerCase());
    expect(params).not.toContain(checksummed);
  });

  it("records an anonymous event when there is no wallet", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new AnalyticsService({ pool: makePool(query) });

    await service.record("plan_generated", null);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]?.[0]).toBeNull();
  });

  // Analytics is bookkeeping attached to real user actions — signing in,
  // generating a plan. A failure here must never surface as a failed request.
  it("swallows database failures instead of throwing into the caller", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection refused"));
    const service = new AnalyticsService({ pool: makePool(query) });

    await expect(service.recordSignIn(WALLET)).resolves.toBeUndefined();
    await expect(service.record("position_opened", WALLET)).resolves.toBeUndefined();
  });
});
