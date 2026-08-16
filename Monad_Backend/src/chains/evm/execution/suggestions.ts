// Will add LLM here for more better solution

import { getChain, type ChainInfo } from "@core/registry/index.js";
import {
  InputTokenMismatch,
  PlannerRefusal,
  UnsupportedAmountOverride,
} from "@shared/errors"

// A recovery hint shown with a failed generation. `insertText` present means
// the frontend renders it as a tappable chip that appends that line to the
// user's prompt; absent means it's a plain textual hint.
export type Suggestion = {
  label: string;
  insertText?: string;
};

function tokenChips(chain: ChainInfo): Suggestion[] {
  return chain.tokens
    .filter((t) => t.inputEnabled)
    .map((t) => ({
      label: `Use ${t.symbol}`,
      insertText: `Use ${t.symbol} as the input token.`,
    }));
}

function marketChips(chain: ChainInfo): Suggestion[] {
  return chain.markets.slice(0, 3).map((m) => ({
    label: m.label,
    insertText: `Supply ${m.collateral} as collateral to Morpho market ${m.label} on ${chain.label}.`,
  }));
}

// Maps a plan failure to actionable recovery suggestions. Returns [] when we
// have nothing better than the raw error — the frontend then falls back to
// today's plain message.
export function suggestionsForError(
  err: unknown,
  chainId: number,
): Suggestion[] {
  const chain = getChain(chainId);
  if (!chain) return [];

  if (err instanceof InputTokenMismatch) {
    return [
      {
        label: `Start from ${err.symbol}`,
        insertText: `I hold ${err.symbol} — start the strategy from ${err.symbol}.`,
      },
    ];
  }

  if (err instanceof UnsupportedAmountOverride) {
    return [];
  }

  const message = (
    err instanceof Error ? err.message : String(err)
  ).toLowerCase();

  if (err instanceof PlannerRefusal) {
    // Unknown token → point at the supported list.
    if (
      message.includes("token") &&
      (message.includes("unknown") ||
        message.includes("address") ||
        message.includes("not in the list"))
    ) {
      return [
        {
          label: `Supported tokens: ${chain.tokens.map((t) => t.symbol).join(", ")}`,
        },
        ...tokenChips(chain),
      ];
    }
    // Multi-protocol percentages that don't sum to 100% → don't guess a fix
    // (we don't know which split they actually meant), just make the ask
    // unmissable rather than burying it in the raw message.
    if (message.includes("sum to 100%")) {
      return [{ label: "Percentages across protocols must add up to 100%" }];
    }
    // Missing / unparseable amount → give a concrete starting line.
    if (message.includes("amount")) {
      return [
        {
          label: `Add "I have 1 ${chain.loanToken} on ${chain.label}."`,
          insertText: `I have 1 ${chain.loanToken} on ${chain.label}.`,
        },
      ];
    }
    return [];
  }

  // Builder/resolver failures.
  if (
    message.includes("market") &&
    (message.includes("not found") ||
      message.includes("was not found") ||
      message.includes("invalid") ||
      message.includes("missing a market"))
  ) {
    return [
      {
        label: `Supported markets: ${chain.markets.map((m) => m.label).join(", ")}`,
      },
      ...marketChips(chain),
    ];
  }


  // UnauthorizedSelector: the swap/bridge calldata targets an unlisted function selector.
  if (message.includes("unauthorizedselector")) {
    return [
      {
        label: "Swap route uses an unsupported DEX function",
      },
      {
        label: "Try a smaller amount or different token pair",
        insertText: "Try the same strategy with a different route.",
      },
    ];
  }

  // UnauthorizedDex: the DEX address returned by LiFi is not on the on-chain whitelist.
  if (message.includes("unauthorizeddex")) {
    return [
      {
        label: "DEX router not whitelisted on-chain",
      },
      {
        label: "Try a different amount to get a different route",
        insertText: "Try a slightly different amount.",
      },
    ];
  }

  // Deposit fee errors (vault governance timelock).
  if (message.includes("feechangenotready")) {
    return [
      { label: "Fee change is still in timelock — try again after the delay period." },
    ];
  }
  if (message.includes("feechangeexpired")) {
    return [
      { label: "Fee change window expired — the owner must re-queue." },
    ];
  }
  if (message.includes("feetoo high")) {
    return [
      { label: "Requested fee exceeds the protocol maximum (5%)." },
    ];
  }

  // Slippage exceeded (common with fee-adjusted deposits or stale quotes).
  if (message.includes("slippageexceeded")) {
    return [
      {
        label: "Slippage exceeded — price moved since quote",
      },
      {
        label: "Retry with fresh quotes",
        insertText: "Retry the same operation.",
      },
    ];
  }

  // Insufficient output from a strategy step (delta verification failure).
  if (message.includes("insufficientoutput")) {
    return [
      {
        label: "A strategy step produced less output than expected",
      },
      {
        label: "Retry — on-chain conditions may have changed",
        insertText: "Retry the strategy.",
      },
    ];
  }

  // Deadline expired (transaction was pending too long).
  if (message.includes("deadlineexpired")) {
    return [
      {
        label: "Transaction deadline expired — resubmit for a fresh deadline",
        insertText: "Retry.",
      },
    ];
  }

  // Borrow step with no resolvable LTV (neither per-step nor a top-level default).
  if (message.includes("target ltv")) {
    return [
      { label: "Add \"at 50% LTV\"", insertText: "Borrow at 50% LTV." },
      { label: "Add \"at 65% LTV\"", insertText: "Borrow at 65% LTV." },
    ];
  }

  return [];
}
