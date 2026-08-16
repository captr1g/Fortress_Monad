import type { FastifyInstance } from "fastify";
import { loadMonadConfig } from "@chains/evm/config/monad.js";
import type { EvmChainConfig } from "@chains/evm/types.js";
import { EvmKernel } from "@chains/evm/kernel.js";
import { Planner } from "@core/planner/planner.js";
import { YieldDomain } from "@domains/yield/index.js";
import { Orchestrator } from "@core/orchestrator.js";
import { FortressLogger } from "@shared/logger.js";
import { createServer } from "@core/api/server.js";
import { registerPlanRoutes } from "@core/api/routes/plan.route.js";
import { registerSimulateRoutes } from "@core/api/routes/simulate.route.js";
import { seedRegistry } from "./registry.js";

export function testLogger(): FortressLogger {
  return FortressLogger.newRequest().at({
    route: "integration-test",
    file: "harness.ts",
    fn: "test",
  });
}

export type ServiceHarness = {
  orchestrator: Orchestrator;
  kernel: EvmKernel;
  config: EvmChainConfig;
  close: () => Promise<void>;
};

export async function buildRealService(): Promise<ServiceHarness> {
  seedRegistry();
  const config = loadMonadConfig();

  const planner = new Planner({
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
  });

  const yieldDomain = new YieldDomain();

  const kernel = new EvmKernel({
    config,
    tenderly: {
      accessKey: process.env.TENDERLY_ACCESS_KEY!,
      accountSlug: process.env.TENDERLY_ACCOUNT_SLUG!,
      projectSlug: process.env.TENDERLY_PROJECT_SLUG!,
    },
  });

  const orchestrator = new Orchestrator({
    planner,
    domains: new Map([["yield", yieldDomain]]),
    kernels: new Map([["monad", kernel]]),
  });

  return {
    orchestrator,
    kernel,
    config,
    close: async () => { },
  };
}

export type AppHarness = {
  app: FastifyInstance;
  orchestrator: Orchestrator;
  kernel: EvmKernel;
  config: EvmChainConfig;
  close: () => Promise<void>;
};

export async function buildRealApp(): Promise<AppHarness> {
  seedRegistry();
  const config = loadMonadConfig();

  const planner = new Planner({
    apiKey: process.env.OPENAI_API_KEY!,
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
  });

  const yieldDomain = new YieldDomain();

  const kernel = new EvmKernel({
    config,
    tenderly: {
      accessKey: process.env.TENDERLY_ACCESS_KEY!,
      accountSlug: process.env.TENDERLY_ACCOUNT_SLUG!,
      projectSlug: process.env.TENDERLY_PROJECT_SLUG!,
    },
  });

  const orchestrator = new Orchestrator({
    planner,
    domains: new Map([["yield", yieldDomain]]),
    kernels: new Map([["monad", kernel]]),
  });

  const app = await createServer({ port: 0 });
  registerPlanRoutes(app, orchestrator, "monad", config.chainId);
  registerSimulateRoutes(app, kernel);
  await app.ready();

  return {
    app,
    orchestrator,
    kernel,
    config,
    close: async () => { await app.close(); },
  };
}
