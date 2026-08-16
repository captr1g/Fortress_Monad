import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { EvmKernel } from "@chains/evm/kernel.js";
import { normalizeIntentAmount } from "@chains/evm/execution/intent-utils.js";
import { suggestionsForError } from "@chains/evm/execution/suggestions.js";
import { IntentSchema } from "@domains/yield/types/intent.js";
import { computeDepositApy } from "@core/services/apy/vault-apy.js";
import { listChains } from "../../registry/index.js";
import { FortressLogger } from "@shared/logger.js";
import { UnsupportedAmountOverride } from "@shared/errors.js";
import { serializePlanResult } from "./plan.controller.js";

const SimulateRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  intent: IntentSchema,
  amount: z.string().regex(/^\d+$/).optional(),
});

export class SimulateController {
  private readonly kernel: EvmKernel;

  constructor(kernel: EvmKernel) {
    this.kernel = kernel;
  }

  async simulate(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest().at({
      route: "POST /fortress/simulate",
      file: "simulate.controller.ts",
      fn: "simulate",
    });
    const body = SimulateRequestSchema.parse(request.body);
    const walletAddress = body.walletAddress as `0x${string}`;

    try {
      const intent = body.amount
        ? normalizeIntentAmount(body.intent, body.amount)
        : body.intent;
      const result = await this.kernel.executeFromIntent(intent, walletAddress, log);

      const depositApy =
        result.intent.action === "deposit" || result.intent.action === "swapAndDeposit"
          ? await computeDepositApy(result.intent.allocations, this.kernel.evmConfig)
          : undefined;

      return reply.status(200).send(serializePlanResult({ ...result, depositApy }));
    } catch (err: unknown) {
      const suggestions = suggestionsForError(err, this.kernel.chainId);
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof UnsupportedAmountOverride) {
        return reply.status(400).send({ error: { stage: "builder", message, suggestions } });
      }
      log.error("SIMULATE FAILED", err);
      return reply.status(422).send({ error: { stage: "builder", message, suggestions } });
    }
  }

  async registry(_request: FastifyRequest, reply: FastifyReply) {
    // Protocol/vault metadata only exists for this controller's own EVM
    // kernel — attach it just to that chain until there's a real multi-chain
    // kernel registry to look up from.
    const protocols = this.kernel.evmConfig.protocols.map((p) => ({
      name: p.name,
      vaultSymbol: p.vaultSymbol,
      kind:
        p.apySource === "none"
          ? ("routing" as const)
          : p.apySource === "pendle-implied"
            ? ("fixed" as const)
            : ("variable" as const),
      pendleMarkets: p.pendleVaultMarkets?.map((m) => ({ label: m.label, market: m.market })),
      // Morpho is the only protocol serving two roles today (a plain-deposit
      // vault AND a separate set of Leverage Loop lending markets) — special
      // cased rather than modeled generically since nothing else does this yet.
      actions:
        p.apySource === "none"
          ? (["Swap"] as const)
          : p.name === "Morpho"
            ? (["Deposit", "Leverage"] as const)
            : (["Deposit"] as const),
    }));

    return reply.status(200).send({
      chains: listChains().map((c) => ({
        chainId: c.chainId,
        label: c.label,
        executable: c.executable,
        loanToken: c.loanToken,
        tokens: c.tokens,
        markets: c.markets,
        protocols: c.chainId === this.kernel.chainId ? protocols : undefined,
      })),
    });
  }
}
