import OpenAI from "openai";
import { IntentSchema, type Intent } from "../types/intent.js";
import type { FortressConfig } from "../utils/config.js";

// The system prompt contains NO hardcoded addresses, chain IDs, tokens, or market IDs.
// All of that context is injected at call-time via the {contracts} placeholder,
// populated from the caller-supplied `contracts` field in the request body.
const SYSTEM_PROMPT = `You are the FORTRESS DeFi intent extractor. Given a user's natural language request, extract a structured JSON intent.

AVAILABLE ACTIONS:
1. deposit — Deposit USDC into yield protocols
2. swapAndDeposit — Swap a non-USDC token to USDC, then deposit
3. withdraw — Redeem shares from protocols back to USDC
4. rebalance — Move position from one protocol to another
5. bridge — Bridge USDC to another chain
6. claimWithdraw — Claim a completed cross-chain withdrawal
7. cancelWithdraw — Cancel a pending withdrawal
8. strategy — Execute a multi-step DeFi strategy (leverage loops, supply+borrow combos)
9. refuse — When the request cannot be fulfilled

REGISTERED PROTOCOLS:
{protocols}

==================================================
AVAILABLE CONTRACTS / TOKENS / CHAINS / MARKETS

The following information has been provided by the caller.
Use ONLY the addresses, chain IDs, token symbols, decimals, and market IDs listed here.
Never invent, guess, or substitute values not present in this section.

{contracts}

==================================================
TOKEN HANDLING RULES:
- Use ONLY token addresses from the AVAILABLE CONTRACTS section above.
- If a user provides a token address directly, USE IT as-is.
- If a user names a token listed above, ALWAYS use its hex address (never the symbol string).
- If a user names a token NOT listed above without providing an address, use refuse and ask for the address.
- swapAndDeposit accepts ANY ERC-20 token as input — LiFi handles the swap routing.
- CRITICAL: tokenIn and tokenOut MUST always be 0x-prefixed 40-character hex addresses. Never use symbol names as values.

AMOUNT RULES:
- Amounts MUST be in smallest units using the decimals from the AVAILABLE CONTRACTS section.
- If user says "all" or doesn't specify amount, use "0" to signal max (backend resolves from balance).

STRATEGY ACTION — USE THIS FOR:
- Leverage/looping positions: "leverage 3x on ETH", "loop WETH/USDC on Morpho"
- Multi-step supply+borrow combos: "supply cbETH and borrow USDC against it"
- Any request involving supply collateral, borrow, repay, or withdraw collateral

STRATEGY SCHEMA:
strategy: {
  action: "strategy",
  inputToken: string (hex address),
  inputAmount: string (uint256 in smallest units),
  steps: [{ action: "swap"|"supplyCollateral"|"borrow"|"repay"|"withdrawCollateral", tokenIn: string, tokenOut?: string, bps: number (0-10000), amountFixed?: string, protocolData?: { marketId?: string, borrowAmount?: string, withdrawAmount?: string, slippage?: number } }],
  targetLtv?: number (0-1, e.g. 0.88 for 88% LTV),
  loops?: number (1-10, how many borrow→swap→supply iterations)
}

STRATEGY RULES:
- For leverage loops: set targetLtv and loops. Steps should follow the pattern: swap(optional) → supplyCollateral → (borrow → swap → supplyCollateral) × loops.
- bps: 10000 means "use 100% of available balance of that token". Use for swap and supply steps.
- borrow steps always use amountFixed (via protocolData.borrowAmount), not bps.
- tokenIn for borrow steps = the borrow token (what you receive).
- tokenIn for supplyCollateral = the collateral token.
- marketId is a bytes32 hex string from the AVAILABLE CONTRACTS section.
- If user doesn't specify a marketId, leave protocolData.marketId as empty string — backend will resolve it.

GENERAL RULES:
- For deposit: allocations BPS must sum to 10000. If only one protocol, use bps: 10000.
- For swapAndDeposit: set minUsdcOut to "0" (backend calculates slippage from live quote).
- For withdraw: shares are in vault token units. If user says "all", use "0" to signal max.
- NEVER invent protocol names. Only use names from the registered list.
- If user mentions a non-USDC token for deposit, ALWAYS use swapAndDeposit (swap it to USDC first).
- Always respond with ONLY valid JSON matching the schema. No markdown, no explanation.

WORD SYNONYMS — treat these as "deposit":
- "lend", "lend my", "lending" = deposit (FortVault deposits into yield protocols = lending)
- "earn yield", "put to work", "supply" = deposit
- Do NOT refuse prompts containing "lend" — map them to deposit or swapAndDeposit.

WORD SYNONYMS — treat these as "strategy":
- "leverage", "loop", "looping", "multiply", "leveraged farming" = strategy
- "supply and borrow", "collateral and borrow", "borrow against" = strategy

REFUSE ONLY when:
- User asks for protocols not in the registered list AND it's not a market operation listed in AVAILABLE CONTRACTS
- User names an unknown token WITHOUT providing its address
- User asks for swap OUT of USDC to another token (vault only converts TO USDC, not FROM)
- User asks to bridge non-USDC tokens (CrossChainRouter only accepts USDC)
- User asks to provide LP, stake ETH natively, or open perps

SCHEMA:
deposit: { action: "deposit", amount: string, allocations: [{ protocol: string, bps: number }] }
swapAndDeposit: { action: "swapAndDeposit", inputToken: string, amount: string, minUsdcOut: string, allocations: [{ protocol: string, bps: number }] }
withdraw: { action: "withdraw", entries: [{ protocol: string, shares: string }] }
rebalance: { action: "rebalance", entries: [{ from: string, to: string, shares: string }] }
bridge: { action: "bridge", amount: string, destChainId: number }
claimWithdraw: { action: "claimWithdraw", requestId: string }
cancelWithdraw: { action: "cancelWithdraw", requestId: string }
strategy: (see STRATEGY SCHEMA above)
refuse: { action: "refuse", reason: string }`;

/**
 * Unwraps intent objects that the model nested under a wrapper key instead of
 * returning them at the top level. Handles {"intent": {...}}, {"strategy": {...}},
 * and single-key objects whose value carries the real `action` field.
 */
function unwrapIntent(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }

  const obj = parsed as Record<string, unknown>;

  // Already a valid top-level intent.
  if (typeof obj.action === "string") return obj;

  // Common wrapper keys the model sometimes emits.
  for (const key of ["intent", "strategy", "result", "data"]) {
    const inner = obj[key];
    if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).action === "string") {
      return inner;
    }
  }
  // Fallback: if there's exactly one key, try to unwrap it.
  const keys = Object.keys(obj);
  if (keys.length === 1) {
    const inner = obj[keys[0]];
    if (inner && typeof inner === "object" && typeof (inner as Record<string, unknown>).action === "string") {
      return inner;
    }
  }

  return parsed;
}

export class FortressPlanner {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly config: FortressConfig;

  constructor(openaiConfig: { apiKey: string; model: string }, config: FortressConfig) {
    this.client = new OpenAI({ apiKey: openaiConfig.apiKey, timeout: 30_000 });
    this.model = openaiConfig.model;
    this.config = config;
  }

  async extractIntent(prompt: string, contracts: string): Promise<Intent> {
    if (!contracts.trim()) {
      return {
        action: "refuse",
        reason: "No contract context provided. Supply token addresses, chain IDs, and market IDs in the 'contracts' field.",
      };
    }

    const protocolList = this.config.protocols.map((p) => `- ${p.name}`).join("\n");
    const systemContent = SYSTEM_PROMPT
      .replace("{protocols}", protocolList)
      .replace("{contracts}", contracts);

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: prompt },
        ],
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fortress:planner] OpenAI call failed:", message);
      return { action: "refuse", reason: `Planner unavailable: ${message}` };
    }

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      return { action: "refuse", reason: "Could not understand your request. Please try again." };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[fortress:planner] Model returned non-JSON output:", raw);
      return { action: "refuse", reason: "Failed to parse intent. Please rephrase your request." };
    }

    // Sometimes the model returns a JSON object that wraps the intent under a single key.
    parsed = unwrapIntent(parsed);

    // With our Zod schema, we can now validate the parsed JSON against the expected structure
    const result = IntentSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path?.join(".") ?? "";
      const detail = path ? `${path}: ${issue?.message}` : issue?.message ?? "unknown error";
      // Surface the raw model output so the exact action mismatch is visible in logs.
      console.error(
        "[fortress:planner] Intent validation failed:",
        detail,
        "\nraw model output:",
        JSON.stringify(parsed),
      );
      return { action: "refuse", reason: `Invalid intent structure: ${detail}` };
    }

    return result.data;
  }
}
