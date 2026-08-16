import { describe, it, expect } from "vitest";
import { z } from "zod";
import { describeIntegration } from "../../helpers/integration.js";
import { BASE_CHAIN_ID } from "../../datasets/base.js";

// Contract: Pendle /core/v2/markets/all still returns { total, results:[{address,pt,yt,name,expiry}] }.
// PendleMarketService.fetchAllMarkets maps exactly these; drift breaks Pendle
// market resolution (fixed-yield deposits and PT loops).

const PENDLE_URL = "https://api-v2.pendle.finance/core/v2/markets/all";

const MarketSchema = z.object({
  address: z.string().min(1),
  pt: z.string().min(1),
  yt: z.string().min(1),
  name: z.string(),
  expiry: z.string(),
});

describeIntegration("contract: Pendle markets/all (Base)", () => {
  it("returns a paginated market list with the fields our client reads", async () => {
    const url = new URL(PENDLE_URL);
    url.searchParams.set("chainId", String(BASE_CHAIN_ID));
    url.searchParams.set("limit", "100");
    url.searchParams.set("skip", "0");

    const res = await fetch(url.toString());
    expect(res.ok).toBe(true);

    const json = (await res.json()) as { total?: number; results?: unknown[] };
    expect(typeof json.total).toBe("number");
    expect(Array.isArray(json.results)).toBe(true);
    expect((json.results ?? []).length).toBeGreaterThan(0);
    // Validate a sample of entries against the shape we depend on.
    for (const m of (json.results ?? []).slice(0, 5)) {
      expect(() => MarketSchema.parse(m)).not.toThrow();
    }
  });
});
