import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildRealApp, type AppHarness } from "../helpers/harness.js";
import { describeIntegration } from "../helpers/integration.js";
import {
  makeDepositIntent,
  makeWithdrawIntent,
} from "../factories/intent.js";
import { WALLETS, BASE_CHAIN_ID, ONE_USDC } from "../datasets/base.js";

// LLM-free re-simulation endpoint + the static registry dump. /simulate hits real
// build + Tenderly but zero OpenAI, so it's cheap and deterministic in shape.

let h: AppHarness;

describeIntegration("api: POST /fortress/simulate + GET /fortress/registry", () => {
  beforeAll(async () => {
    h = await buildRealApp();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("200: rebuilds and re-simulates a posted-back deposit intent", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/simulate",
      payload: { walletAddress: WALLETS.preview, intent: makeDepositIntent() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.intent.action).toBe("deposit");
    expect(body.transactions.length).toBeGreaterThanOrEqual(2);
  });

  it("200: applies an amount override on the re-simulation", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/simulate",
      payload: {
        walletAddress: WALLETS.preview,
        intent: makeDepositIntent(),
        amount: (ONE_USDC / 2n).toString(),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().intent.amount).toBe((ONE_USDC / 2n).toString());
  });

  it("400: rejects an amount override on a non-rescalable (withdraw) intent", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/simulate",
      payload: {
        walletAddress: WALLETS.preview,
        intent: makeWithdrawIntent(),
        amount: "1000000",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/don't support an amount override/);
  });

  it("400: rejects a body missing the intent", async () => {
    const res = await h.app.inject({
      method: "POST",
      url: "/fortress/simulate",
      payload: { walletAddress: WALLETS.preview },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200: GET /fortress/registry returns Base with tokens and markets", async () => {
    const res = await h.app.inject({ method: "GET", url: "/fortress/registry" });
    expect(res.statusCode).toBe(200);
    const base = res.json().chains.find((c: { chainId: number }) => c.chainId === BASE_CHAIN_ID);
    expect(base).toBeDefined();
    expect(base.executable).toBe(true);
    expect(base.tokens.some((t: { symbol: string }) => t.symbol === "USDC")).toBe(true);
    expect(base.markets.some((m: { label: string }) => m.label === "cbETH-USDC")).toBe(true);
  });
});
