import { describe, it, expect, beforeAll } from "vitest";
import { Planner } from "@core/planner/planner.js";
import { YieldDomain } from "@domains/yield/index.js";
import type { AssemblyContext } from "@core/planner/prompt-assembler.js";
import { describeIntegration } from "../../helpers/integration.js";
import { seedRegistry } from "../../helpers/registry.js";

let planner: Planner;
let ctx: AssemblyContext;

describeIntegration("integration: Planner (real OpenAI)", () => {
  beforeAll(() => {
    seedRegistry();
    planner = new Planner({
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.OPENAI_MODEL ?? "gpt-4o",
    });
    ctx = {
      chainKey: "monad",
      domains: new Map([["yield", new YieldDomain()]]),
      configProtocols: ["Morpho", "Aave", "Fluid", "Euler", "CompoundV3", "Pendle", "LiFi"],
    };
  });

  it("extracts a deposit intent from a plain deposit prompt", async () => {
    const envelope = await planner.extractIntent("Deposit 1 USDC to Morpho", ctx);
    expect(envelope.action).toBe("deposit");
    expect(envelope.domain).toBe("yield");
  });

  it("extracts a leverage intent with a multiplier", async () => {
    const envelope = await planner.extractIntent("Open 2x leverage on cbETH with 1 USDC", ctx);
    expect(envelope.action).toBe("leverage");
  });

  it("refuses an out-of-domain request instead of hallucinating an intent", async () => {
    const envelope = await planner.extractIntent("What is the capital of France?", ctx);
    expect(envelope.action).toBe("refuse");
  });
});
