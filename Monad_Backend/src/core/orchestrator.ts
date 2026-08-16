// This is the entryfile, 
// It is initiated in boot.ts with domains(prediction market or yield or RWA),kernals(EVM, SVM) and Planner(gpt4o).
// It's responsible for orchestrating the planning process.

import { Planner, type PlannerOptions } from "./planner/planner.js";
import type { AssemblyContext } from "./planner/prompt-assembler.js";
import type { DomainModule } from "@domains/yield/index.js";
import type { YieldDomain } from "@domains/yield/index.js";
import type { EvmKernel, KernelResult } from "@chains/evm/kernel.js";
import type { Intent } from "@domains/yield/types/intent.js";
import type { DepositApy } from "@domains/yield/types/market.js";
import type { TokenInfo } from "./registry/index.js";
import { InputTokenMismatch, PlannerRefusal } from "@shared/errors.js";
import { StrategyValidationError } from "@chains/evm/execution/strategy-validator.js";
import { readCachedProtocolApys } from "./services/apy/vault-apy.js";
import { suggestLoop, type LoopSuggestion } from "@domains/yield/loop-suggestion.js";
import { FortressLogger } from "@shared/logger.js";
import { intentInputToken } from "@chains/evm/execution/intent-utils.js";
import type { Redis } from "ioredis";
import type { StrategyApy } from "./services/apy/types.js";
import { Address } from "viem";

// Plan Result
export type PlanResult = {
  intent: Intent;
  description: string;
  transactions: KernelResult["transactions"];
  simulation: KernelResult["simulation"];
  apy?: StrategyApy;
  depositApy?: DepositApy;
  loopSuggestion?: LoopSuggestion;
};

export class Orchestrator {
  private readonly planner: Planner;
  private readonly domains: Map<string, YieldDomain>;
  private readonly kernels: Map<string, EvmKernel>;
  private readonly redis?: Redis;

  constructor(deps: {
    planner: Planner;
    domains: Map<string, YieldDomain>;
    kernels: Map<string, EvmKernel>;
    redis?: Redis;
  }) {
    this.planner = deps.planner;
    this.domains = deps.domains;
    this.kernels = deps.kernels;
    this.redis = deps.redis;
  }

  // Function to process a plan.
  // Here we first build AssemblyContext{chainkey, domains, protocolnames} and extract the intent using planner(prompt, assemblyccontext, plannerOpts).
  // Now if the action is not in (Chains X Capabilities) then refuse it
  // extract the domain and parse the payload with intent type defined in domain
  // get the kernal for the chain and execute the intent
  // compute APY for non-strategical operations and return the final PlanResult
  async plan(
    prompt: string,
    chainKey: string,
    walletAddress: Address,
    log: FortressLogger,
    opts?: { inputToken?: TokenInfo },
  ): Promise<PlanResult> {
    log.at({ file: "orchestrator.ts", fn: "plan" });
    log.prompt(prompt);

    const assemblyCtx: AssemblyContext = {
      chainKey,
      domains: this.domains as unknown as Map<string, DomainModule>,
      // apySource: "none" marks a registry entry kept only for its on-chain
      // address (e.g. LiFi's router, used by the swap resolver) — not a real
      // deposit/withdraw target. Telling the planner it's "valid for deposit"
      // let prompts like "deposit across all protocols" try to route funds
      // into LiFi itself, which isn't a vault.
      configProtocols: this.getKernel(chainKey)
        .evmConfig.protocols.filter((p) => p.apySource !== "none")
        .map((p) => p.name),
      rates: await this.currentRates(chainKey),
    };

    const plannerOpts: PlannerOptions | undefined = opts?.inputToken
      ? { inputToken: opts.inputToken }
      : undefined;

    // The gpt-5 family can't be pinned to temperature 0, so `seed` (best-effort
    // per OpenAI's own docs) is the only determinism lever the planner has —
    // it occasionally samples a structurally-valid but wrong intent (e.g. a
    // borrow step naming the wrong token for its market). Re-running the
    // planner on a fresh sample is cheap relative to the cost of surfacing an
    // avoidable failure to the user, so retry once specifically on
    // StrategyValidationError before giving up. Other failures (refusal,
    // input-token mismatch, simulation/execution errors) are not retried —
    // those are either legitimate outcomes or won't be fixed by re-sampling
    // the planner.
    const MAX_PLAN_ATTEMPTS = 2;
    let kernel: EvmKernel | undefined;
    let domain: YieldDomain | undefined;
    let intent: Intent | undefined;
    let result: KernelResult | undefined;
    let chainKeyResolved = chainKey;

    for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS; attempt++) {
      const envelope = await this.planner.extractIntent(prompt, assemblyCtx, plannerOpts);
      log.intent(envelope);

      // Handle refusal that means LLM can't do what user asked for
      if (envelope.action === "refuse") {
        const reason = (envelope.payload as { reason?: string })?.reason ?? "Request refused.";
        throw new PlannerRefusal(reason);
      }

      // Resolve domain and parse payload
      const candidateDomain = this.getDomain(envelope.domain);
      const candidateIntent = candidateDomain.parsePayload(envelope);

      // Binding input-token check
      if (opts?.inputToken) {
        const actual = intentInputToken(candidateIntent);
        if (actual && actual.toLowerCase() !== opts.inputToken.address.toLowerCase()) {
          throw new InputTokenMismatch(opts.inputToken.symbol, opts.inputToken.address);
        }
      }

      log.action(candidateIntent.action);
      chainKeyResolved = envelope.chainKey;

      try {
        kernel = this.getKernel(envelope.chainKey);
        result = await kernel.execute(candidateIntent, walletAddress, log);
        intent = candidateIntent;
        domain = candidateDomain;
        break;
      } catch (err) {
        if (err instanceof StrategyValidationError && attempt < MAX_PLAN_ATTEMPTS) {
          console.warn(`[orchestrator] plan attempt ${attempt} failed validation, retrying:`, err.message);
          continue;
        }
        throw err;
      }
    }

    if (!kernel || !domain || !intent || !result) {
      // Unreachable in practice — the loop only exits via `break` (all set)
      // or a `throw` (propagates out). Guards TypeScript's control-flow
      // analysis and any future refactor of the loop above.
      throw new Error("plan() failed to produce a result");
    }

    // Compute domain-specific previews
    const depositApy = await domain.computeDepositApy(
      result.intent,
      kernel.evmConfig,
      this.redis,
    );

    // Only swapAndDeposit intents name a specific starting asset the user
    // already holds — a plain deposit is USDC by definition, nothing to
    // loop. Undefined (not attempted, no rate available, or not clearly
    // better) just means no suggestion, never a guessed one.
    const loopSuggestion =
      result.intent.action === "swapAndDeposit"
        ? await suggestLoop({
            chainKey: chainKeyResolved,
            chainId: kernel.chainId,
            inputTokenAddress: result.intent.inputToken,
            currentNetApy: depositApy?.netApy ?? null,
            apyResolver: kernel.apyResolver,
          })
        : undefined;

    return {
      intent: result.intent,
      description: result.description,
      transactions: result.transactions,
      simulation: result.simulation,
      apy: result.apy,
      depositApy,
      loopSuggestion,
    };
  }

  // LLM-free re-simulation: takes an already-validated intent, builds + simulates
  async planFromIntent(
    intent: Intent,
    chainKey: string,
    walletAddress: Address,
    log: FortressLogger,
  ): Promise<PlanResult> {
    const kernel = this.getKernel(chainKey);
    const domain = this.getDomain("yield");
    const result = await kernel.execute(intent, walletAddress, log);

    const depositApy = await domain.computeDepositApy(
      result.intent,
      kernel.evmConfig,
      this.redis,
    );

    return {
      intent: result.intent,
      description: result.description,
      transactions: result.transactions,
      simulation: result.simulation,
      apy: result.apy,
      depositApy,
    };
  }

  // Strategy preview (build only, no simulate)
  async previewStrategy(
    prompt: string,
    chainKey: string,
    walletAddress: Address,
    log: FortressLogger,
  ): Promise<{ intent: Intent; description: string; apy?: StrategyApy }> {
    const assemblyCtx: AssemblyContext = {
      chainKey,
      domains: this.domains as unknown as Map<string, DomainModule>,
      // apySource: "none" marks a registry entry kept only for its on-chain
      // address (e.g. LiFi's router, used by the swap resolver) — not a real
      // deposit/withdraw target. Telling the planner it's "valid for deposit"
      // let prompts like "deposit across all protocols" try to route funds
      // into LiFi itself, which isn't a vault.
      configProtocols: this.getKernel(chainKey)
        .evmConfig.protocols.filter((p) => p.apySource !== "none")
        .map((p) => p.name),
      rates: await this.currentRates(chainKey),
    };

    const envelope = await this.planner.extractIntent(prompt, assemblyCtx);

    if (envelope.action === "refuse") {
      const reason = (envelope.payload as { reason?: string })?.reason ?? "Request refused.";
      throw new PlannerRefusal(reason);
    }

    const domain = this.getDomain(envelope.domain);
    const intent = domain.parsePayload(envelope);
    const kernel = this.getKernel(chainKey);
    const { description, apy } = await kernel.preview(intent, walletAddress, log);

    return { intent, description, apy };
  }

  // A pure Redis read of whatever the background warmer last cached — never
  // a live call on the user's clock. No redis configured, or nothing cached
  // yet, just means no rates section gets added to the prompt.
  private async currentRates(chainKey: string): Promise<{ name: string; apy: number }[] | undefined> {
    if (!this.redis) return undefined;
    const kernel = this.kernels.get(chainKey);
    if (!kernel) return undefined;
    return readCachedProtocolApys(kernel.evmConfig.protocols, this.redis);
  }

  private getDomain(name: string): YieldDomain {
    const domain = this.domains.get(name);
    if (!domain) throw new PlannerRefusal(`Domain "${name}" is not registered.`);
    return domain;
  }

  private getKernel(chainKey: string): EvmKernel {
    const kernel = this.kernels.get(chainKey);
    if (!kernel) throw new PlannerRefusal(`Chain "${chainKey}" is not registered.`);
    return kernel;
  }
}
