import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { PositionsService } from "../../services/positions/index.js";
import { PositionsController } from "../controllers/positions.controller.js";
import { createAuthMiddleware } from "../../services/auth/middleware.js";

export function registerPositionsRoutes(
  app: FastifyInstance,
  service: PositionsService,
  redis?: Redis,
): void {
  const controller = new PositionsController(service);
  // A wallet's Morpho positions are private balance/debt data — the wallet
  // they're read for must come from the verified session, not a query/body
  // param anyone can set to any address. Falls back to the claimed address
  // only when there's no Redis to hold a session (local dev).
  const preHandler = redis ? [createAuthMiddleware(redis)] : [];

  const handleList = (req: any, reply: any) => controller.list(req, reply);
  const handleRefresh = (req: any, reply: any) => controller.refresh(req, reply);

  app.get("/fortress/positions", { preHandler }, handleList);
  app.get("/api/fortress/positions", { preHandler }, handleList);

  app.post("/fortress/positions/refresh", { preHandler }, handleRefresh);
  app.post("/api/fortress/positions/refresh", { preHandler }, handleRefresh);
}
