import { describe, it, expect, beforeAll } from "vitest";
import { buildRealService, testLogger, type ServiceHarness } from "../../helpers/harness.js";
import { describeIntegration } from "../../helpers/integration.js";
import { assertWellFormedTx, assertWellFormedSimulation } from "../../helpers/assertions.js";
import { makeDepositIntent, makeSplitDepositIntent } from "../../factories/intent.js";
import { WALLETS, MONAD_CHAIN_ID, ONE_USDC } from "../../datasets/monad.js";
import type { Intent } from "@domains/yield/types/intent.js";

let h: ServiceHarness;

describeIntegration("integration: deposit plan (real build + real Tenderly)", () => {
  beforeAll(async () => {
    h = await buildRealService();
  });

  it("builds approve→USDC and deposit→vault, and round-trips through Tenderly", async () => {
    const result = await h.kernel.execute(
      makeDepositIntent() as Intent,
      WALLETS.preview,
      testLogger(),
    );

    expect(result.intent.action).toBe("deposit");
    expect(result.transactions.length).toBeGreaterThanOrEqual(2);
    for (const tx of result.transactions) assertWellFormedTx(tx, MONAD_CHAIN_ID);
    expect(result.transactions[0].to.toLowerCase()).toBe(h.config.usdc.toLowerCase());
    expect(result.transactions.at(-1)!.to.toLowerCase()).toBe(h.config.vault.toLowerCase());
    assertWellFormedSimulation(result.simulation);
    expect(result.simulation.gasUsed).toBeGreaterThan(0n);
  });

  it("builds a multi-protocol split deposit with well-formed calldata", async () => {
    const result = await h.kernel.execute(
      makeSplitDepositIntent() as Intent,
      WALLETS.preview,
      testLogger(),
    );
    for (const tx of result.transactions) assertWellFormedTx(tx, MONAD_CHAIN_ID);
    assertWellFormedSimulation(result.simulation);
  });

  it("re-sizes correctly via the LLM-free amount override path", async () => {
    const smaller = makeDepositIntent({ amount: (ONE_USDC / 2n).toString() });
    const result = await h.kernel.execute(smaller as Intent, WALLETS.preview, testLogger());
    expect(result.intent.action === "deposit" && result.intent.amount).toBe((ONE_USDC / 2n).toString());
    for (const tx of result.transactions) assertWellFormedTx(tx, MONAD_CHAIN_ID);
  });
});
