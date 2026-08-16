import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildRealApp, type AppHarness } from "../helpers/harness.js";
import { describeIntegration } from "../helpers/integration.js";
import { WALLETS, TOKENS, MONAD_CHAIN_ID } from "../datasets/monad.js";

// Real wired Fastify app via app.inject (no socket). Success path hits real
// OpenAI + Tenderly; failure paths exercise validation, refusal, and error
// mapping. Covers the full HTTP contract of POST /fortress/plan.

let h: AppHarness;

describeIntegration("api: POST /fortress/plan", () => {
  beforeAll(async () => {
    h = await buildRealApp();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("200: returns a serialized plan for a valid deposit prompt", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { prompt: "Deposit 1 USDC to Morpho", walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intent.action).toBe("deposit");
    expect(Array.isArray(body.transactions)).toBe(true);
    expect(body.transactions.length).toBeGreaterThanOrEqual(2);
    // Fully JSON-safe: value + gasUsed serialized as strings.
    expect(typeof body.transactions[0].value).toBe("string");
    expect(typeof body.simulation.gasUsed).toBe("string");
    expect(body.transactions[0].chainId).toBe(MONAD_CHAIN_ID);
    expect(body).toHaveProperty("depositApy");
  });

  it("400: rejects a missing prompt (schema validation)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.category).toBe("validation");
  });

  it("400: rejects an empty prompt", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { prompt: "", walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400: rejects an over-long prompt (>2000 chars)", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { prompt: "a".repeat(2001), walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400: rejects a malformed wallet address", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { prompt: "Deposit 1 USDC to Morpho", walletAddress: "0x1234" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400: rejects an unregistered inputToken with a planner-stage error", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: {
        prompt: "Deposit 1 USDC to Morpho",
        walletAddress: WALLETS.preview,
        inputToken: "0x000000000000000000000000000000000000dEaD",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.stage).toBe("planner");
  });

  it("422: maps a planner refusal to a 422 with suggestions", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/plan",
      payload: { prompt: "What is the capital of France?", walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.stage).toBe("planner");
    expect(body.error).toHaveProperty("suggestions");
  });
});
