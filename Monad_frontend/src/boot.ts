import "dotenv/config";
import { z } from "zod";
import { createPublicClient, http, type Chain } from "viem";
import { base, mainnet, arbitrum } from "viem/chains";

import { registerChain } from "./core/registry/chains.js";
import { registerCapabilities } from "./core/registry/capabilities.js";
import { createServer } from "./core/api/server.js";
import { loadBaseConfig } from "./chains/evm/config/base.js";
import { verifyProtocolInvariants } from "./chains/evm/config/invariants.js";

import { Planner } from "./core/planner/planner.js";
import { YieldDomain } from "./domains/yield/index.js";
import { EvmKernel } from "./chains/evm/kernel.js";
import { Orchestrator } from "./core/orchestrator.js";

import { registerPlanRoutes } from "./core/api/routes/plan.route.js";
import { registerSimulateRoutes } from "./core/api/routes/simulate.route.js";
import { registerExitRoutes } from "./core/api/routes/exit.route.js";
import { registerWithdrawRoutes } from "./core/api/routes/withdraw.route.js";
import { registerPositionsRoutes } from "./core/api/routes/positions.route.js";
import { registerStrategiesRoutes } from "./core/api/routes/strategies.route.js";
import { registerSavedStrategiesRoutes } from "./core/api/routes/saved-strategies.route.js";
import { registerAuthRoutes } from "./core/services/auth/index.js";
import { registerAdminMetricsRoutes } from "./core/api/routes/admin-metrics.route.js";

import { startApyService } from "./core/services/apy/index.js";
import { startVaultApyWarmer } from "./core/services/apy/vault-apy-warmer.js";
import { connectRedis } from "./core/services/apy/cache/redis.js";
import { startPositionsService } from "./core/services/positions/index.js";
import { startStrategiesService } from "./core/services/strategies/index.js";
import { startSavedStrategiesService } from "./core/services/saved-strategies/index.js";
import { startAnalyticsService } from "./core/services/analytics/index.js";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o"),
  OPENAI_BASE_URL: z.string().optional().default(""),
  // Cascade of additional models to try on the same (OpenRouter) client
  // before falling back to a different provider entirely — comma-separated,
  // tried in order. See planner.ts for why: free models get rate-limited by
  // aggregate demand across every OpenRouter user, not just this app.
  OPENAI_FALLBACK_MODELS: z.string().optional().default(""),
  // A different provider's key/model, tried only after every model above has
  // failed — e.g. the original paid OpenAI key.
  OPENAI_FINAL_FALLBACK_API_KEY: z.string().optional().default(""),
  OPENAI_FINAL_FALLBACK_MODEL: z.string().optional().default("gpt-4o"),
  OPENAI_FINAL_FALLBACK_BASE_URL: z.string().optional().default(""),
  TENDERLY_ACCESS_KEY: z.string().min(1),
  TENDERLY_ACCOUNT_SLUG: z.string().min(1),
  TENDERLY_PROJECT_SLUG: z.string().min(1),
  RPC_BASE: z.string().url(),
  RPC_ETH: z.string().optional().default(""),
  RPC_ARB: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3000),
  LIFI_API_KEY: z.string().optional().default(""),
});

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);

  // --- Chain Registry ---
  registerChain({
    chainKey: "base",
    chainId: 8453,
    vm: "evm",
    label: "Base",
    executable: true,
    loanToken: "USDC",
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, stable: true, inputEnabled: true },
      { symbol: "USDbC", name: "USD Base Coin", address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6, stable: true },
      { symbol: "WETH", name: "Wrapped Ether", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
      { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18 },
      { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
      { symbol: "wstETH", name: "Wrapped Staked ETH", address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18 },
      { symbol: "weETH", name: "Wrapped eETH", address: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A", decimals: 18 },
      { symbol: "ezETH", name: "Renzo Restaked ETH", address: "0x2416092f143378750bb29b79eD961ab195CcEea5", decimals: 18 },
      { symbol: "DAI", name: "Dai Stablecoin", address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, stable: true },
      { symbol: "EURC", name: "Euro Coin", address: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", decimals: 6, stable: true },
      { symbol: "AERO", name: "Aerodrome", address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
      { symbol: "DEGEN", name: "Degen", address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18 },
    ],
    markets: [
      { label: "cbETH-USDC", collateral: "cbETH", loan: "USDC" },
      { label: "cbBTC-USDC", collateral: "cbBTC", loan: "USDC" },
      { label: "wstETH-USDC", collateral: "wstETH", loan: "USDC" },
      { label: "ezETH-USDC", collateral: "ezETH", loan: "USDC" },
      { label: "WETH-USDC", collateral: "WETH", loan: "USDC" },
    ],
  });

  registerChain({
    chainKey: "ethereum",
    chainId: 1,
    vm: "evm",
    label: "Ethereum",
    executable: false,
    loanToken: "USDC",
    tokens: [
      { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, stable: true },
    ],
    markets: [],
  });

  registerChain({
    chainKey: "arbitrum",
    chainId: 42161,
    vm: "evm",
    label: "Arbitrum",
    executable: false,
    loanToken: "USDC",
    tokens: [],
    markets: [],
  });

  // --- Capabilities ---
  registerCapabilities([
    { chainKey: "base", domain: "yield", protocol: "Morpho", actions: ["deposit", "withdraw", "leverage", "strategy", "exit"] },
    { chainKey: "base", domain: "yield", protocol: "Aave", actions: ["deposit", "withdraw"] },
    { chainKey: "base", domain: "yield", protocol: "Fluid", actions: ["deposit", "withdraw"] },
    { chainKey: "base", domain: "yield", protocol: "Euler", actions: ["deposit", "withdraw"] },
    { chainKey: "base", domain: "yield", protocol: "CompoundV3", actions: ["deposit", "withdraw"] },
    { chainKey: "base", domain: "yield", protocol: "Pendle", actions: ["deposit", "withdraw", "strategy"] },
    { chainKey: "base", domain: "yield", protocol: "LiFi", actions: ["swap", "bridge"] },
  ]);

  // --- Core Services ---
  const baseChainConfig = loadBaseConfig();

  // Verify backend protocol addresses match on-chain vault registry
  const invariantResult = await verifyProtocolInvariants(baseChainConfig);
  if (invariantResult.skipped) {
    console.log(`[invariant:${invariantResult.chainKey}] Skipped (no vault or RPC).`);
  } else if (!invariantResult.ok) {
    console.error(`[FATAL] Protocol mismatch on "${invariantResult.chainKey}" (${invariantResult.chainId}):`);
    for (const m of invariantResult.mismatches) {
      console.error(`  ${m.protocol}: config=${m.configAddress}, on-chain=${m.onChainAddress}`);
    }
    process.exit(1);
  } else {
    console.log(`[invariant:${invariantResult.chainKey}] All protocols verified.`);
  }

  const yieldRedis = process.env.APY_REDIS_URL
    ? await connectRedis(process.env.APY_REDIS_URL)
    : undefined;

  const app = await createServer({ port: env.PORT, redis: yieldRedis });

  // Started before any route that reports into it. Undefined only if its
  // schema couldn't be created (see analytics/index.ts), in which case every
  // call site below no-ops.
  const analytics = await startAnalyticsService();

  const rpcs: Record<number, string> = { 8453: env.RPC_BASE };
  if (env.RPC_ETH) rpcs[1] = env.RPC_ETH;
  if (env.RPC_ARB) rpcs[42161] = env.RPC_ARB;
  const CHAIN_MAP: Record<number, Chain> = { 8453: base, 1: mainnet, 42161: arbitrum };

  const apyResolver = await startApyService(app, {
    getClient: (chainId: number) => {
      const rpcUrl = rpcs[chainId] ?? env.RPC_BASE;
      const chain = CHAIN_MAP[chainId] ?? base;
      return createPublicClient({ chain, transport: http(rpcUrl) });
    },
  });

  // Keeps deposit-protocol rates (Morpho vault, Aave, Fluid, Euler,
  // CompoundV3, Pendle) warm in Redis so the planner can read current rates
  // at prompt-assembly time without ever making a live call on a user's
  // request. See vault-apy-warmer.ts.
  if (yieldRedis) {
    startVaultApyWarmer({ config: baseChainConfig, redis: yieldRedis, intervalMs: 60_000 });
    console.log("[vault-apy-warmer] Started — polling every 60000ms");
  }

  // --- Architecture: Planner → Domain → Kernel → Orchestrator ---
  const planner = new Planner({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseURL: env.OPENAI_BASE_URL || undefined,
    fallbackModels: env.OPENAI_FALLBACK_MODELS
      ? env.OPENAI_FALLBACK_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
      : undefined,
    finalFallback: env.OPENAI_FINAL_FALLBACK_API_KEY
      ? {
        apiKey: env.OPENAI_FINAL_FALLBACK_API_KEY,
        model: env.OPENAI_FINAL_FALLBACK_MODEL,
        baseURL: env.OPENAI_FINAL_FALLBACK_BASE_URL || undefined,
      }
      : undefined,
  });

  const yieldDomain = new YieldDomain();

  const evmKernel = new EvmKernel({
    config: baseChainConfig,
    tenderly: {
      accessKey: env.TENDERLY_ACCESS_KEY,
      accountSlug: env.TENDERLY_ACCOUNT_SLUG,
      projectSlug: env.TENDERLY_PROJECT_SLUG,
    },
    apyResolver,
  });

  const orchestrator = new Orchestrator({
    planner,
    domains: new Map([["yield", yieldDomain]]),
    kernels: new Map([["base", evmKernel]]),
    redis: yieldRedis,
  });

  // --- Routes ---
  // Self-invocation target for the async plan worker (see plan.controller.ts) —
  // same instance, loopback, so Cloud Run treats that call as a genuine
  // active request and keeps CPU allocated for its full duration.
  registerPlanRoutes(app, orchestrator, "base", baseChainConfig.chainId, yieldRedis, `http://127.0.0.1:${env.PORT}`, analytics);
  registerSimulateRoutes(app, evmKernel);

  // Strategies service needs the orchestrator for preview builds
  const strategiesService = await startStrategiesService({
    orchestrator,
    kernel: evmKernel,
    apyResolver,
    chainId: baseChainConfig.chainId,
  });
  registerStrategiesRoutes(app, strategiesService);

  registerExitRoutes(app, {
    config: baseChainConfig,
    tenderly: {
      accessKey: env.TENDERLY_ACCESS_KEY,
      accountSlug: env.TENDERLY_ACCOUNT_SLUG,
      projectSlug: env.TENDERLY_PROJECT_SLUG,
    },
    redis: yieldRedis,
  });

  registerWithdrawRoutes(app, {
    config: baseChainConfig,
    tenderly: {
      accessKey: env.TENDERLY_ACCESS_KEY,
      accountSlug: env.TENDERLY_ACCOUNT_SLUG,
      projectSlug: env.TENDERLY_PROJECT_SLUG,
    },
    redis: yieldRedis,
  });

  const positionsService = await startPositionsService({
    rpcUrl: env.RPC_BASE,
    morphoBlue: baseChainConfig.morphoBlue,
    chainId: baseChainConfig.chainId,
    apyResolver,
    analytics,
  });
  registerPositionsRoutes(app, positionsService, yieldRedis);

  const savedStrategiesService = await startSavedStrategiesService();
  registerSavedStrategiesRoutes(app, savedStrategiesService, yieldRedis, analytics);

  // --- Auth ---
  if (process.env.APY_REDIS_URL) {
    const { Redis } = await import("ioredis");
    const redis = new Redis(process.env.APY_REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    registerAuthRoutes(app, redis, analytics);
    console.log("[auth] Routes registered");

    // Admin dashboard. Needs analytics (something to report) and a non-empty
    // allowlist (someone allowed to read it) — without either there is nothing
    // to serve, so the route simply isn't registered.
    const adminWallets = (process.env.ADMIN_WALLETS ?? "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (analytics && adminWallets.length > 0) {
      registerAdminMetricsRoutes(app, analytics, redis, adminWallets);
      console.log(`[admin-metrics] Routes registered for ${adminWallets.length} wallet(s)`);
    } else if (analytics) {
      console.warn(
        "[admin-metrics] ADMIN_WALLETS not set — dashboard route not registered.",
      );
    }
  } else {
    console.warn("[auth] APY_REDIS_URL not set, auth disabled");
  }

  // --- Start ---
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`Server started on port ${env.PORT}`);
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
