import type { FastifyRequest, FastifyReply } from "fastify";
import {
  SavedStrategiesService,
  LimitReachedError,
  NotFoundError,
} from "../../services/saved-strategies/saved-strategies.service.js";
import type { AnalyticsService } from "../../services/analytics/index.js";

export class SavedStrategiesController {
  private readonly service: SavedStrategiesService;
  private readonly analytics?: AnalyticsService;

  constructor(service: SavedStrategiesService, analytics?: AnalyticsService) {
    this.service = service;
    this.analytics = analytics;
  }

  async list(wallet: string, _request: FastifyRequest, reply: FastifyReply) {
    try {
      const items = await this.service.list(wallet);
      return reply.status(200).send({ items });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "saved-strategies", message } });
    }
  }

  async save(
    body: {
      walletAddress: string;
      name: string;
      prompt: string;
      preview: unknown;
    },
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const row = await this.service.save({
        wallet: body.walletAddress,
        name: body.name,
        prompt: body.prompt,
        preview: body.preview,
      });

      // saved_strategies already records this, but rows there are deleted when a
      // user removes a strategy (and capped at 3 per wallet), so it can't answer
      // "how many strategies were ever saved". This event can.
      await this.analytics?.record("strategy_saved", body.walletAddress);

      return reply.status(201).send({ id: row.id });
    } catch (err: unknown) {
      if (err instanceof LimitReachedError) {
        return reply
          .status(409)
          .send({ error: { stage: "saved-strategies", message: err.message } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "saved-strategies", message } });
    }
  }

  async remove(
    id: string,
    wallet: string,
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      await this.service.remove(id, wallet);
      return reply.status(204).send();
    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        return reply
          .status(404)
          .send({ error: { stage: "saved-strategies", message: err.message } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "saved-strategies", message } });
    }
  }

  async rename(
    id: string,
    body: { walletAddress: string; name: string },
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const row = await this.service.rename(id, body.walletAddress, body.name);
      return reply.status(200).send(row);
    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        return reply
          .status(404)
          .send({ error: { stage: "saved-strategies", message: err.message } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "saved-strategies", message } });
    }
  }

  async touchUsage(
    id: string,
    body: { walletAddress: string },
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    try {
      const row = await this.service.touchUsage(id, body.walletAddress);
      return reply.status(200).send(row);
    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        return reply
          .status(404)
          .send({ error: { stage: "saved-strategies", message: err.message } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return reply
        .status(422)
        .send({ error: { stage: "saved-strategies", message } });
    }
  }
}
