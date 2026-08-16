import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { ExitService } from "@chains/evm/protocols/morpho/exit.service.js";
import { ExitRequestSchema } from "@domains/yield/types/exit.js";
import { FortressLogger } from "@shared/logger.js";

const PositionQuerySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  market: z.string().min(1),
});

export class ExitController {
  private readonly service: ExitService;

  constructor(service: ExitService) {
    this.service = service;
  }

  async position(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest().at({
      route: "GET /fortress/position",
      file: "exit.controller.ts",
      fn: "position",
    });
    const q = PositionQuerySchema.parse(request.query);
    const walletAddress = request.walletAddress ?? q.walletAddress;

    try {
      const position = await this.service.readPositionForMarket(
        q.market,
        walletAddress as `0x${string}`,
      );
      return reply.status(200).send({ position });
    } catch (err: unknown) {
      log.error("POSITION FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "position", message } });
    }
  }

  async exit(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest().at({
      route: "POST /fortress/exit",
      file: "exit.controller.ts",
      fn: "exit",
    });
    const parsed = ExitRequestSchema.parse(request.body);
    const body = { ...parsed, walletAddress: request.walletAddress ?? parsed.walletAddress };
    log.action(`exit:${body.mode}`);

    try {
      const result = await this.service.buildExit(body);
      log.simulation(result.simulation);

      return reply.status(200).send({
        description: result.description,
        transactions: result.transactions.map((tx) => ({
          to: tx.to,
          data: tx.data,
          value: tx.value.toString(),
          chainId: tx.chainId,
        })),
        simulation: {
          success: result.simulation.success,
          gasUsed: result.simulation.gasUsed.toString(),
          error: result.simulation.error ?? null,
        },
        position: result.position,
        settlement: result.settlement,
      });
    } catch (err: unknown) {
      log.error("EXIT FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "exit", message } });
    }
  }
}
