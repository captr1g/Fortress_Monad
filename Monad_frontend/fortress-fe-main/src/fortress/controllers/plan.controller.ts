import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { FortressService, PlannerRefusal } from "../services/plan.service.js";
import { FortressLogger } from "../utils/logger.js";

// Schema for request including prompt, wallet address, and caller-supplied contract context
const PlanRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /**
   * Caller-supplied context injected into the planner system prompt.
   * Include every token address (with decimals), chain ID, market ID, and
   * protocol detail the intent may reference. Nothing is assumed by the planner.
   *
   * Example:
   *   CHAIN: Base (8453)
   *   TOKENS:
   *     USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals) — only token accepted by deposit
   *     WETH: 0x4200000000000000000000000000000000000006 (18 decimals)
   *   MORPHO MARKETS:
   *     WETH/USDC 86% LLTV: 0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda
   */
  contracts: z.string().min(1, "contracts must not be empty"),
});

export class FortressController {
  private readonly service: FortressService;

  constructor(service: FortressService) {
    this.service = service;
  }

  async plan(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest();

    const body = PlanRequestSchema.parse(request.body);
    const walletAddress = body.walletAddress as `0x${string}`;

    try {
      const result = await this.service.plan(body.prompt, walletAddress, log, body.contracts);

      return reply.status(200).send({
        intent: result.intent,
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
      });
    } catch (err: unknown) {
      if (err instanceof PlannerRefusal) {
        log.refuse(err.message);
        return reply.status(422).send({ error: { stage: "planner", message: err.message } });
      }

      log.error("FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "builder", message } });
    }
  }
}
