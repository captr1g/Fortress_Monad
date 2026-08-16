import type { FastifyInstance } from "fastify";
import type { StrategiesService } from "../../services/strategies/strategies.service.js";
import { StrategiesController } from "../controllers/strategies.controller.js";

export function registerStrategiesRoutes(
  app: FastifyInstance,
  service: StrategiesService,
): void {
  const controller = new StrategiesController(service);
  const handleList = (req: any, reply: any) => controller.list(req, reply);

  app.get("/fortress/strategies", handleList);
  app.get("/api/fortress/strategies", handleList);
}
