// YieldDomain module 

import type { ChainInfo } from "@core/registry/index.js";
import type { IntentEnvelope } from "@core/planner/intent-envelope.js";
import { IntentSchema, type Intent } from "./types/intent.js";
import { yieldPromptFragment } from "./prompt-fragment.js";
import { computeDepositApy } from "@core/services/apy/vault-apy.js";
import type { EvmChainConfig } from "@chains/evm/types.js";
import type { DepositApy } from "./types/market.js";
import type { Redis } from "ioredis";

export interface DomainModule {
  readonly domain: string;
  promptFragment(chain: ChainInfo, protocols: string[]): string;
  parsePayload(envelope: IntentEnvelope): Intent;
}

export class YieldDomain implements DomainModule {
  readonly domain = "yield";

  promptFragment(chain: ChainInfo, protocols: string[]): string {
    return yieldPromptFragment(chain, protocols);
  }

  parsePayload(envelope: IntentEnvelope): Intent {
    return IntentSchema.parse(envelope.payload);
  }

  async computeDepositApy(
    intent: Intent,
    config: EvmChainConfig,
    redis?: Redis,
  ): Promise<DepositApy | undefined> {
    if (intent.action !== "deposit" && intent.action !== "swapAndDeposit") {
      return undefined;
    }
    return computeDepositApy(intent.allocations, config, redis);
  }
}
