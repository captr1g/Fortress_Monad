import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { ExitController } from "../controllers/exit.controller.js";
import { ExitService } from "@chains/evm/protocols/morpho/exit.service.js";
import { EvmSimulator } from "@chains/evm/simulator.js";
import type { EvmChainConfig } from "@chains/evm/types.js";
import { createAuthMiddleware } from "../../services/auth/middleware.js";

type RouteDeps = {
  config: EvmChainConfig;
  tenderly: { accessKey: string; accountSlug: string; projectSlug: string };
  redis?: Redis;
};

export function registerExitRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const simulator = new EvmSimulator(deps.tenderly);
  const service = new ExitService(deps.config, simulator);
  const controller = new ExitController(service);
  // Position data and exit settlement figures are private to the wallet
  // they're for — read the wallet from the verified session, not a
  // query/body param anyone can set to any address. Falls back to the
  // claimed address only when there's no Redis to hold a session (local dev).
  const preHandler = deps.redis ? [createAuthMiddleware(deps.redis)] : [];

  const handlePosition = (req: any, reply: any) => controller.position(req, reply);
  const handleExit = (req: any, reply: any) => controller.exit(req, reply);

  app.get("/fortress/position", { preHandler }, handlePosition);
  app.get("/api/fortress/position", { preHandler }, handlePosition);

  app.post("/fortress/exit", { preHandler }, handleExit);
  app.post("/api/fortress/exit", { preHandler }, handleExit);
}
