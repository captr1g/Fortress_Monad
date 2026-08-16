import type { FastifyRequest, FastifyReply } from "fastify";
import type { StrategiesService } from "../../services/strategies/strategies.service.js";

export class StrategiesController {
  private readonly service: StrategiesService;

  constructor(service: StrategiesService) {
    this.service = service;
  }

  async list(_request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await this.service.list();
      return reply.status(200).send(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "strategies", message } });
    }
  }
}
