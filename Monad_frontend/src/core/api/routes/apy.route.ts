import type { FastifyInstance } from "fastify";
import type pg from "pg";
import type { Redis } from "ioredis";
import { ApyController } from "../controllers/apy.controller.js";

type RouteDeps = { pool: pg.Pool; redis: Redis };

export function registerApyRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const controller = new ApyController(deps.pool, deps.redis);

  app.get("/apy/markets", (req, reply) => controller.markets(req, reply));
  app.get("/apy/:marketId", (req, reply) => controller.rateByMarket(req, reply));
  app.get("/apy/batch", (req, reply) => controller.batch(req, reply));
  app.get("/apy/health", (req, reply) => controller.health(req, reply));
}
