import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { PositionsService } from "../../services/positions/index.js";
import { FortressLogger } from "@shared/logger.js";

const WalletQuerySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const RefreshBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export class PositionsController {
  private readonly service: PositionsService;

  constructor(service: PositionsService) {
    this.service = service;
  }

  async list(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest();
    const q = WalletQuerySchema.parse(request.query);
    const walletAddress = request.walletAddress ?? q.walletAddress;
    try {
      const result = await this.service.getPositions(walletAddress);
      return reply.status(200).send(result);
    } catch (err: unknown) {
      log.error("POSITIONS FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "positions", message } });
    }
  }

  async refresh(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest();
    const body = RefreshBodySchema.parse(request.body);
    const walletAddress = request.walletAddress ?? body.walletAddress;
    try {
      const positions = await this.service.refresh(walletAddress);
      return reply.status(200).send({ positions });
    } catch (err: unknown) {
      log.error("POSITIONS REFRESH FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "positions", message } });
    }
  }
}
