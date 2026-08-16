import type { FastifyInstance } from "fastify";
import type { EvmKernel } from "@chains/evm/kernel.js";
import { SimulateController } from "../controllers/simulate.controller.js";

export function registerSimulateRoutes(
  app: FastifyInstance,
  kernel: EvmKernel,
): void {
  const controller = new SimulateController(kernel);

  const handleSimulate = (req: any, reply: any) => controller.simulate(req, reply);
  const handleRegistry = (req: any, reply: any) => controller.registry(req, reply);

  app.post("/fortress/simulate", handleSimulate);
  app.post("/api/fortress/simulate", handleSimulate);

  app.get("/fortress/registry", handleRegistry);
  app.get("/api/fortress/registry", handleRegistry);
}
