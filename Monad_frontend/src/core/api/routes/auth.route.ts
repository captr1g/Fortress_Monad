// Auth route registration. URLs: /auth/nonce, /auth/verify, /auth/me, /auth/logout
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { AuthController } from "../controllers/auth.controller.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

export function registerAuthRoutes(
  app: FastifyInstance,
  redis: Redis,
  analytics?: AnalyticsService,
): void {
  const controller = new AuthController(redis, analytics);

  app.post("/auth/nonce", (req, reply) => controller.nonce(req, reply));
  app.post("/auth/verify", (req, reply) => controller.verify(req, reply));
  app.get("/auth/me", (req, reply) => controller.me(req, reply));
  app.post("/auth/logout", (req, reply) => controller.logout(req, reply));
}
