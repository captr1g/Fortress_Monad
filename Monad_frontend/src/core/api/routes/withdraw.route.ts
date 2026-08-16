import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { WithdrawController } from "../controllers/withdraw.controller.js";
import { WithdrawService } from "@chains/evm/contracts/vault-withdraw.js";
import { CalldataBuilder } from "@chains/evm/contracts/vault-builder.js";
import { EvmSimulator } from "@chains/evm/simulator.js";
import type { EvmChainConfig } from "@chains/evm/types.js";
import { createAuthMiddleware } from "../../services/auth/middleware.js";

type RouteDeps = {
  config: EvmChainConfig;
  tenderly: { accessKey: string; accountSlug: string; projectSlug: string };
  redis?: Redis;
};

export function registerWithdrawRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): void {
  const builder = new CalldataBuilder(deps.config);
  const simulator = new EvmSimulator(deps.tenderly);
  const service = new WithdrawService(deps.config, builder, simulator);
  const controller = new WithdrawController(service, builder, simulator, deps.config);
  // A withdraw is built for a specific wallet's balance — read it from the
  // verified session, not a body param anyone can set to any address. Falls
  // back to the claimed address only when there's no Redis to hold a
  // session (local dev).
  const preHandler = deps.redis ? [createAuthMiddleware(deps.redis)] : [];

  const handleWithdraw = (req: any, reply: any) => controller.withdraw(req, reply);

  app.post("/fortress/withdraw", { preHandler }, handleWithdraw);
  app.post("/api/fortress/withdraw", { preHandler }, handleWithdraw);
}
