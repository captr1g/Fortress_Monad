import type { FastifyInstance } from "fastify";
import { FortressController } from "../controllers/plan.controller.js";
import { FortressService } from "../services/plan.service.js";
import { FortressPlanner } from "../helpers/planner.js";
import { CalldataBuilder } from "../helpers/builder.js";
import { FortressSimulator } from "../helpers/simulator.js";
import type { FortressConfig } from "../utils/config.js";

type RouteDeps = {
  config: FortressConfig;
  openai: { apiKey: string; model: string };
  tenderly: { accessKey: string; accountSlug: string; projectSlug: string };
};

export function registerFortressRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const planner = new FortressPlanner(deps.openai, deps.config);
  const builder = new CalldataBuilder(deps.config);
  const simulator = new FortressSimulator(deps.tenderly);
  const service = new FortressService({ planner, builder, simulator, config: deps.config });
  const controller = new FortressController(service);

  app.post("/fortress/plan", (req, reply) => controller.plan(req, reply));
}
