// Utility functions for intent amount normalization. Used by the simulate route
// for LLM-free re-simulation (rescale intent to a new amount without replanning).

import type { Intent } from "@domains/yield/types/intent.js";
import { UnsupportedAmountOverride } from "@shared/errors.js";

// The address a plan actually starts from, per intent shape.
export function intentInputToken(intent: Intent): string | undefined {
  switch (intent.action) {
    case "strategy":
    case "leverage":
    case "swapAndDeposit":
      return intent.inputToken;
    default:
      return undefined;
  }
}

// Rescale an intent to a new input amount. Strategy intents also get their
// steps' amountFixed cleared so bps-proportional sizing recomputes from scratch.
export function normalizeIntentAmount(intent: Intent, amount: string): Intent {
  switch (intent.action) {
    case "strategy":
      return {
        ...intent,
        inputAmount: amount,
        steps: intent.steps.map(({ amountFixed: _drop, ...step }) => step),
      };
    case "leverage":
      return { ...intent, inputAmount: amount };
    case "deposit":
    case "swapAndDeposit":
    case "bridge":
      return { ...intent, amount };
    default:
      throw new UnsupportedAmountOverride(intent.action);
  }
}
