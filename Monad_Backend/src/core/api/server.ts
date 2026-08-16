// Fastify server factory — creates and configures the HTTP server with CORS, cookies,
// JSON parsing, BigInt serialization, rate limiting, and a unified error handler.
// Route registration is done externally by the boot file.

import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { PlannerRefusal } from "@shared/errors.js";
import { createRateLimiter, createRedisRateLimiter } from "./middleware/rate-limit.js";
import type { Redis } from "ioredis";

export type ServerConfig = {
  port: number;
  rateLimit?: { maxRequests: number; windowMs: number };
  redis?: Redis;
};

export async function createServer(
  config: ServerConfig,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // CORS: allowlist the known production domains, Vercel preview deploys, and
  // localhost. Does NOT fall back to permissive — unrecognized origins are
  // rejected.
  //
  // Both variable names are accepted. The code only ever read
  // CORS_EXTRA_ORIGINS, while .env.example, every deployed .env and the compose
  // files all set CORS_ALLOWED_ORIGINS — so the configured origins were being
  // silently discarded and any host outside the hardcoded list got a CORS
  // failure with no clue why. Requests are sent with `credentials: "include"`,
  // so a rejected origin fails the whole call, not just cookie propagation.
  const configuredOrigins = [
    process.env.CORS_ALLOWED_ORIGINS ?? "",
    process.env.CORS_EXTRA_ORIGINS ?? "",
  ]
    .flatMap((v) => v.split(","))
    .map((o) => o.trim())
    .filter(Boolean);

  // `*` is documented in .env.example as "or * for dev". It cannot be served as
  // a literal `Access-Control-Allow-Origin: *` here — browsers reject that
  // combined with credentials — so it means "echo whatever origin asked".
  const allowAny = configuredOrigins.includes("*");

  const allowedOriginPatterns: RegExp[] = [
    /^https:\/\/app\.fortress\.exchange$/,
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/,
    /^https?:\/\/localhost:\d+$/,
    /^https?:\/\/127\.0\.0\.1:\d+$/,
    ...configuredOrigins
      .filter((o) => o !== "*")
      .map((o) => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
  ];

  if (allowAny) {
    console.warn(
      "[cors] '*' configured — every origin will be accepted WITH credentials. " +
      "Never run a public deployment this way.",
    );
  } else {
    const extra = configuredOrigins.length
      ? configuredOrigins.join(", ")
      : "(none configured)";
    console.log(`[cors] Allowing localhost, *.vercel.app, app.fortress.exchange, ${extra}`);
  }

  await app.register(cors, {
    origin: (origin, cb) => {
      // No Origin header (curl, server-to-server, same-origin) — allow.
      if (!origin) return cb(null, true);
      if (allowAny) return cb(null, true);
      const ok = allowedOriginPatterns.some((re) => re.test(origin));
      // A blocked origin is almost always a missing CORS_ALLOWED_ORIGINS entry,
      // and the browser-side error ("CORS policy") names neither the origin nor
      // the fix. Say it here, where someone can act on it.
      if (!ok) {
        console.warn(
          `[cors] Rejected origin ${origin}. Add it to CORS_ALLOWED_ORIGINS ` +
          `(comma-separated) if this is a legitimate frontend.`,
        );
      }
      cb(null, ok);
    },
    credentials: true,
  });
  await app.register(cookie);

  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.addHook("preSerialization", async (_request, _reply, payload) => {
    return JSON.parse(
      JSON.stringify(payload, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    );
  });

  const isDev = process.env.NODE_ENV !== "production";
  const defaultMax = isDev ? 2000 : 60;
  const { maxRequests = defaultMax, windowMs = 60_000 } = config.rateLimit ?? {};
  // The plan-status poll is hit every couple seconds for the life of a plan
  // request (legitimately 1-3+ minutes for a complex strategy — see
  // pollPlanJob's comment), and shares this IP-wide bucket with every other
  // request the same user's browser makes in that window. It was built to be
  // "deliberately cheap/fast" and safe to poll frequently (its own comment in
  // plan.route.ts says so) but was never actually exempted from this limiter,
  // so a normal amount of other app activity during a long plan could and did
  // trip a 429 mid-poll, killing an otherwise-successful job client-side for
  // no real reason. It has no meaningful cost to leave unmetered here — it's
  // a cheap Redis read, and POST /fortress/plan (the expensive step) keeps
  // its own dedicated per-day limiter regardless.
  const skipPlanPoll = (request: FastifyRequest) => {
    return (
      request.method === "GET" &&
      /^\/(api\/)?fortress\/plan\/[^/]+$/.test(request.routeOptions?.url ?? request.url)
    );
  };

  // Use Redis-backed limiter in production (shared state, TTL eviction, fails closed).
  // Fall back to in-memory with cleanup for local dev.
  if (config.redis) {
    const redisLimiter = createRedisRateLimiter(config.redis, maxRequests, windowMs, skipPlanPoll);
    app.addHook("preHandler", redisLimiter);
  } else {
    const memLimiter = createRateLimiter(maxRequests, windowMs, skipPlanPoll);
    app.addHook("preHandler", memLimiter);
  }

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
        error: { stage: "planner", message: error.message },
      });
    }

    console.error("[server] unhandled error:", error);
    return reply.status(500).send({
      error: {
        stage: "api",
        category: "unknown",
        message: "Internal server error",
      },
    });
  });

  return app;
}
