import "dotenv/config";
import { z } from "zod";
import { createPublicClient, http, type Chain } from "viem";
import { monad, monadTestnet } from "viem/chains";

import { registerChain } from "./core/registry/chains.js";
import { registerCapabilities } from "./core/registry/capabilities.js";
import { createServer } from "./core/api/server.js";
import {
  loadMonadConfig,
  MONAD_CHAIN_ID,
  MONAD_TESTNET_CHAIN_ID,
  MONAD_DEFAULT_RPC,
} from "./chains/evm/config/monad.js";
import { verifyProtocolInvariants, verifyChainIdentity } from "./chains/evm/config/invariants.js";

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
  // The one RPC this backend talks to. Monad is the only executable chain —
  // there is no Base/Ethereum/Arbitrum fallback.
  RPC_MONAD: z.string().url().default("https://rpc.monad.xyz"),
  PORT: z.coerce.number().int().positive().default(3000),
  LIFI_API_KEY: z.string().optional().default(""),
});

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);

  // --- Chain Registry ---
  // Monad mainnet is the only chain FORTRESS registers. Every address below was
  // verified against live RPC — see Monad_Contract/Fortress/ADDRESSES.md §2.
  registerChain({
    chainKey: "monad",
    chainId: MONAD_CHAIN_ID,
    vm: "evm",
    label: "Monad",
    executable: true,
    loanToken: "USDC",
    tokens: [
      { symbol: "USDC", name: "USD Coin", address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", decimals: 6, stable: true, inputEnabled: true },
      { symbol: "WMON", name: "Wrapped Monad", address: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", decimals: 18 },
      { symbol: "WETH", name: "Wrapped Ether", address: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", decimals: 18 },
      { symbol: "WBTC", name: "Wrapped Bitcoin", address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8 },
      { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b", decimals: 8 },
      { symbol: "USDT0", name: "Tether USD (USDT0)", address: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", decimals: 6, stable: true },
      { symbol: "AUSD", name: "Agora Dollar", address: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", decimals: 6, stable: true },
      { symbol: "shMON", name: "FastLane Staked MON", address: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c", decimals: 18 },
    ],
    // Morpho Blue markets are not yet used from the backend: the leverage/exit
    // executors that would trade against them are not deployed on Monad. Left
    // empty rather than listing markets no code path can act on.
    markets: [],
  });

  // --- Capabilities ---
  // Only what the deployed Monad contracts can actually execute today.
  //
  // NOT registered, deliberately:
  //  - "leverage" / "exit" / "strategy": MorphoLeverageExecutor,
  //    MorphoExitExecutor and FortStrategyExecutor are not deployed on Monad
  //    (DEPLOYMENT.md §1). The services stay in the tree; add the actions here
  //    once the executors are live and their addresses are set in the env.
  //  - shMONAD: registered on-chain, but its adapter takes IFortProtocolEx
  //    `data` carrying a full USDC->MON swap route. The backend has no builder
  //    for that payload yet, so planning it would emit reverting calldata.
  registerCapabilities([
    { chainKey: "monad", domain: "yield", protocol: "Aave", actions: ["deposit", "withdraw"] },
    { chainKey: "monad", domain: "yield", protocol: "Neverland", actions: ["deposit", "withdraw"] },
    { chainKey: "monad", domain: "yield", protocol: "Curvance", actions: ["deposit", "withdraw"] },
    { chainKey: "monad", domain: "yield", protocol: "Euler", actions: ["deposit", "withdraw"] },
    { chainKey: "monad", domain: "yield", protocol: "Morpho", actions: ["deposit", "withdraw"] },
    { chainKey: "monad", domain: "yield", protocol: "LiFi", actions: ["swap", "bridge"] },
  ]);

  // --- Core Services ---
  const monadChainConfig = loadMonadConfig();

  // Verify the configured chain IS the chain the RPC serves, and that every
  // configured address actually exists on it. Runs before the protocol
  // invariant below because that one reads the vault's registry and passes
  // happily on a config that mixes chains — see verifyChainIdentity's comment.
  const identity = await verifyChainIdentity(monadChainConfig);
  if (identity.skipped) {
    console.log("[chain-identity] Skipped (no RPC configured).");
  } else if (!identity.ok) {
    console.error(
      `[FATAL] Chain configuration does not match ${monadChainConfig.rpcUrl}:`,
    );
    for (const e of identity.errors) console.error(`  - ${e}`);
    console.error(
      "\n  Leave these unset in .env to use the verified Monad defaults in\n" +
      "  src/chains/evm/config/monad.ts. Refusing to start rather than build\n" +
      "  transactions against addresses that do not exist.",
    );
    process.exit(1);
  } else {
    console.log(
      `[chain-identity] Verified against ${monadChainConfig.rpcUrl} (chain ${monadChainConfig.chainId}).`,
    );
  }

  // Verify backend protocol addresses match on-chain vault registry
  const invariantResult = await verifyProtocolInvariants(monadChainConfig);
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

  // Monad only. Testnet is mapped so a testnet FORTRESS_CHAIN_ID still resolves
  // to the right viem chain, but nothing else routes off-chain-id.
  const rpcs: Record<number, string> = {
    [MONAD_CHAIN_ID]: env.RPC_MONAD,
    [MONAD_TESTNET_CHAIN_ID]: process.env.RPC_MONAD_TESTNET || monadTestnet.rpcUrls.default.http[0],
  };
  const CHAIN_MAP: Record<number, Chain> = {
    [MONAD_CHAIN_ID]: monad,
    [MONAD_TESTNET_CHAIN_ID]: monadTestnet,
  };

  const apyResolver = await startApyService(app, {
    getClient: (chainId: number) => {
      const rpcUrl = rpcs[chainId] ?? env.RPC_MONAD ?? MONAD_DEFAULT_RPC;
      const chain = CHAIN_MAP[chainId] ?? monad;
      return createPublicClient({ chain, transport: http(rpcUrl) });
    },
  });

  // Keeps deposit-protocol rates (Morpho vault, Aave, Fluid, Euler,
  // CompoundV3, Pendle) warm in Redis so the planner can read current rates
  // at prompt-assembly time without ever making a live call on a user's
  // request. See vault-apy-warmer.ts.
  if (yieldRedis) {
    startVaultApyWarmer({ config: monadChainConfig, redis: yieldRedis, intervalMs: 60_000 });
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
    config: monadChainConfig,
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
    kernels: new Map([["monad", evmKernel]]),
    redis: yieldRedis,
  });

  // --- Routes ---
  // Self-invocation target for the async plan worker (see plan.controller.ts) —
  // same instance, loopback, so Cloud Run treats that call as a genuine
  // active request and keeps CPU allocated for its full duration.
  registerPlanRoutes(app, orchestrator, "monad", monadChainConfig.chainId, yieldRedis, `http://127.0.0.1:${env.PORT}`, analytics);
  registerSimulateRoutes(app, evmKernel);

  // Strategies service needs the orchestrator for preview builds
  const strategiesService = await startStrategiesService({
    orchestrator,
    kernel: evmKernel,
    apyResolver,
    chainId: monadChainConfig.chainId,
  });
  registerStrategiesRoutes(app, strategiesService);

  registerExitRoutes(app, {
    config: monadChainConfig,
    tenderly: {
      accessKey: env.TENDERLY_ACCESS_KEY,
      accountSlug: env.TENDERLY_ACCOUNT_SLUG,
      projectSlug: env.TENDERLY_PROJECT_SLUG,
    },
    redis: yieldRedis,
  });

  registerWithdrawRoutes(app, {
    config: monadChainConfig,
    tenderly: {
      accessKey: env.TENDERLY_ACCESS_KEY,
      accountSlug: env.TENDERLY_ACCOUNT_SLUG,
      projectSlug: env.TENDERLY_PROJECT_SLUG,
    },
    redis: yieldRedis,
  });

  const positionsService = await startPositionsService({
    rpcUrl: env.RPC_MONAD,
    morphoBlue: monadChainConfig.morphoBlue,
    chainId: monadChainConfig.chainId,
    apyResolver,
    analytics,
  });
  registerPositionsRoutes(app, positionsService, yieldRedis);

  const savedStrategiesService = await startSavedStrategiesService();
  registerSavedStrategiesRoutes(app, savedStrategiesService, yieldRedis, analytics);

  // --- Auth ---
  // Reuses the shared cluster-aware client from connectRedis. A second plain
  // client here would break against sharded Redis (MOVED redirects).
  if (yieldRedis) {
    const redis = yieldRedis;
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
