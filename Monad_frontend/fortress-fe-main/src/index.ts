import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { createPublicClient, http, type Chain } from "viem";
import { base, mainnet, arbitrum } from "viem/chains";
import { loadConfig } from "./config/index.js";
import { createRateLimiter } from "./api/rate-limit.js";
import { PlannerRefusal } from "./fortress/services/plan.service.js";
import { loadFortressConfig } from "./fortress/index.js";
import { registerFortressRoutes } from "./fortress/routes/plan.route.js";
import { registerPositionsRoutes } from "./fortress/routes/positions.route.js";
import { registerPipelineRoutes } from "./api/pipeline.route.js";
import { registerStrategiesRoutes } from "./api/strategies.route.js";
import { startApyService } from "./services/apy/index.js";
import { getAuthRedis } from "./services/auth/session.js";
import { registerAuthRoutes } from "./services/auth/routes.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const app = Fastify({ logger: false });

  // Allow requests from the fortress-main dev server (3001), Vite (5173),
  // the deployed Render frontend, and any extra origins in CORS_ORIGIN.
  const allowedOrigins = [
    "http://localhost:3001",
    "http://localhost:5173",
    "https://prompt-2-defi.onrender.com",
    ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) : []),
  ];
  await app.register(cors, { origin: allowedOrigins, credentials: true });
  await app.register(cookie);

  // Custom JSON parser
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // BigInt serialization hook
  app.addHook("preSerialization", async (_request, _reply, payload) => {
    return JSON.parse(JSON.stringify(payload, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    ));
  });

  // Rate limiter
  const rateLimiter = createRateLimiter(60, 60_000);
  app.addHook("preHandler", rateLimiter);

  // Error handler
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          stage: "api",
          category: "validation",
          message: "Request validation failed",
          details: {
            fields: error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        },
      });
    }

    if (error instanceof PlannerRefusal) {
      return reply.status(422).send({
        error: {
          stage: "planner",
          message: error.message,
        },
      });
    }

    return reply.status(500).send({
      error: {
        stage: "api",
        category: "unknown",
        message: "Internal server error",
      },
    });
  });

  // Fortress routes (POST /fortress/plan) — legacy single-shot endpoint
  const fortressConfig = loadFortressConfig();
  registerFortressRoutes(app, {
    config: fortressConfig,
    openai: config.openai,
    tenderly: config.tenderly,
  });
  console.log("[fortress] Routes registered");

  // Pipeline routes (POST /plan, /validate, /simulate, /execute) — fortress-main frontend
  registerPipelineRoutes(app, {
    config: fortressConfig,
    openai: config.openai,
    tenderly: config.tenderly,
  });
  console.log("[pipeline] Routes registered");

  // Strategies CRUD (GET|POST /strategies, GET|PATCH /strategies/:id)
  registerStrategiesRoutes(app);
  console.log("[strategies] Routes registered");

  // Auth + positions routes (both share the same Redis connection)
  const apyRedisUrl = process.env.APY_REDIS_URL;
  if (apyRedisUrl) {
    const redis = getAuthRedis(apyRedisUrl);
    registerAuthRoutes(app, redis);
    console.log("[auth-service] Routes registered");
    registerPositionsRoutes(app, { redis });
    console.log("[positions] Routes registered");
  } else {
    console.warn("[auth-service] APY_REDIS_URL not set, auth + positions refresh disabled");
  }

  // APY service
  const rpcs: Record<number, string> = { 8453: config.rpc.base };
  if (config.rpc.eth) rpcs[1] = config.rpc.eth;
  if (config.rpc.arb) rpcs[42161] = config.rpc.arb;

  const CHAIN_MAP: Record<number, Chain> = { 8453: base, 1: mainnet, 42161: arbitrum };

  await startApyService(app, {
    getClient: (chainId: number) => {
      const rpcUrl = rpcs[chainId] ?? config.rpc.base;
      const chain = CHAIN_MAP[chainId] ?? base;
      return createPublicClient({ chain, transport: http(rpcUrl) });
    },
  }).catch((err) => {
    console.error("[apy-service] Failed to start:", err);
  });

  await app.listen({ port: config.server.port, host: "0.0.0.0" });
  console.log(`Server started on port ${config.server.port}`);
}

main().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
