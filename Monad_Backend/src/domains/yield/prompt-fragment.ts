// Build the Yield prompt — dynamic with chains and protocols.
//
// Every section below is gated on something the chain can actually execute.
// A prompt that advertises an action the backend will reject is worse than a
// shorter prompt: the planner emits it, the build throws, and the user gets a
// failure instead of a refusal. So:
//   - Morpho strategy/leverage sections appear only when the chain has
//     registered markets (Monad registers none — the executors that trade
//     against them are not deployed, see boot.ts).
//   - Pendle and Aerodrome sections appear only when those protocols are
//     registered for this chain.
//   - The "never refuse these" list is generated from the live protocol list
//     rather than hardcoded, so it can never name a venue that has gone away.

import type { ChainInfo } from "@core/registry/index.js";
import { findToken } from "@core/registry/index.js";

export function yieldPromptFragment(
  chain: ChainInfo,
  protocols: string[],
): string {
  const protocolList = protocols.map((p) => `- ${p}`).join("\n");
  const protocolNames = protocols.join(", ");
  const has = (name: string): boolean =>
    protocols.some((p) => p.toLowerCase() === name.toLowerCase());

  // Morpho Blue collateral/borrow actions. Both the markets AND the on-chain
  // executors are required; the registry only carries markets when a chain has
  // both, so this one flag gates every market-dependent section.
  const marketActions = chain.markets.length > 0;
  const marketLabels = chain.markets.map((m) => `"${m.label}"`).join(", ");
  const hasPendle = has("Pendle");
  const hasAerodrome = has("Aerodrome");

  const actions: string[] = [
    "deposit — Deposit USDC into yield protocols",
    "swapAndDeposit — Swap a non-USDC token to USDC, then deposit",
    "withdraw — Redeem shares from protocols back to USDC",
    "rebalance — Move position from one protocol to another",
    "bridge — Bridge USDC to another chain",
    "claimWithdraw — Claim a completed cross-chain withdrawal",
    "cancelWithdraw — Cancel a pending withdrawal",
  ];
  if (marketActions) {
    actions.push(
      "strategy — Execute a multi-step DeFi strategy (explicit loop sequences, Pendle PT loops, supply+borrow combos)",
      "leverage — Open an exact-multiplier leveraged Morpho position in one signature via a flash loan",
    );
  }
  actions.push("refuse — When the request cannot be fulfilled");
  const actionList = actions.map((a, i) => `${i + 1}. ${a}`).join("\n");

  const sections: string[] = [];

  sections.push(`YIELD DOMAIN — AVAILABLE ACTIONS:
${actionList}

REGISTERED PROTOCOLS (ALL are valid for deposit/withdraw/rebalance — NEVER refuse any of these):
${protocolList}
IMPORTANT: Every protocol listed above is fully supported. If the user names any protocol from this list, use it directly in allocations. Do NOT refuse it.`);

  const stable = buildStableDistinction(chain);
  if (stable) sections.push(stable);

  sections.push(`TOKEN HANDLING RULES:
- The token list above is for convenience. ANY valid 0x address can be used as inputToken for swapAndDeposit.
- If a user provides a token address directly, USE IT as-is. Do not refuse because it's not in the list.
- If a user names a token from the token list, ALWAYS use the hex address (never the symbol string).
- If a user names a token NOT in the list without an address, refuse and ask them to provide the address.
- swapAndDeposit accepts ANY ERC-20 token as input — LiFi handles the swap routing.
- CRITICAL: tokenIn and tokenOut MUST always be 0x-prefixed 40-character hex addresses. Never use symbol names.

INPUT TOKEN CONSTRAINT:
- The user message may end with a system-provided block starting "INPUT TOKEN CONSTRAINT:". When present, the named token is the ONLY token the user holds and the plan MUST start from it: use it as the input token for swapAndDeposit, and use plain deposit only if it is USDC. If the requested plan cannot start from that token, refuse and explain why.`);

  if (marketActions) {
    sections.push(buildStrategySection(marketLabels));
    if (hasPendle) sections.push(buildPendleStrategySection());
    sections.push(`LEVERAGE ACTION — USE THIS FOR:
- Simple one-shot leverage: "open 2x leverage on WETH with 100 USDC", "long cbBTC 3x with 500 USDC"
- inputToken = loan token (USDC). collateralToken = leveraged asset. multiplier = Nx (1-10).
- marketId is optional: only set if user gives an explicit bytes32.
- Do NOT emit steps for leverage — it is a single structured action, not a strategy.
- Choose strategy (not leverage) when the user spells out an explicit repeated loop${hasPendle ? " or uses Pendle PT/YT" : ""}.`);
  } else {
    // Without markets there is no supply-collateral/borrow path at all. Say so
    // explicitly — otherwise the planner invents a "strategy" action that this
    // chain has no schema for, and the request dies at build time rather than
    // coming back as a clean refusal the user can act on.
    sections.push(`LEVERAGE AND MULTI-STEP STRATEGIES ARE NOT AVAILABLE ON ${chain.label.toUpperCase()}:
- There are no Morpho Blue collateral markets registered on this chain, so there is NO supplyCollateral, borrow, repay, withdrawCollateral, loop, or flash-loan leverage path.
- NEVER emit action "strategy" or action "leverage". They are not valid actions here and are not in the PAYLOAD SCHEMA below.
- If the user asks to leverage, loop, borrow, supply collateral, or open a leveraged position, refuse with: "Leveraged and multi-step Morpho strategies aren't available on ${chain.label} yet — only deposits, withdrawals, rebalances and bridges are supported."
- If the user asks to swap USDC into another token WITHOUT a deposit, refuse — the vault only accepts inflows TO USDC.`);
  }

  sections.push(`CROSS-CHAIN BRIDGE ACTION — USE THIS FOR:
- Moving USDC from this chain to another chain: "bridge 100 USDC to Arbitrum", "send 50 usdc to ethereum", "move USDC from ${chain.chainKey} to optimism", "swap 1 usdc from ${chain.chainKey} to arb".
- CRITICAL: a request phrased as "swap/send/move/transfer <amount> USDC from <chainA> to <chainB>" is a BRIDGE, not a same-chain swap. Same token (USDC), different chain. Do NOT refuse it under the "sell USDC into another token" rule — the token does not change, only the chain does.
- destChainId — map the destination chain name to its numeric id:
    - Ethereum / mainnet / eth → 1
    - Arbitrum / arb → 42161
    - Optimism / op → 10
  Only these destinations are supported. If the user names any other destination chain, refuse and say only Ethereum, Arbitrum, and Optimism are supported.
- amount is USDC in smallest units (6 decimals): "1 USDC" → "1000000", "100 USDC" → "100000000". "bridge all" / "everything" → amount: "0" (backend resolves the live balance).
- Only USDC can be bridged. If the user asks to bridge a non-USDC token, refuse.`);

  if (hasPendle) {
    sections.push(`PENDLE VENUE VS PENDLE STRATEGY — CRITICAL DISTINCTION:
- "deposit into Pendle" / "put money in Pendle fixed yield" / "allocate to Pendle" as PART OF A DEPOSIT → use deposit action with protocol "Pendle" in allocations. User may optionally name a market.
${marketActions ? `- User names a SPECIFIC Pendle market, says PT/YT/LP explicitly, or asks to supply/borrow/loop → use strategy action.
- NEVER put "Pendle" in a deposit allocation AND ALSO emit strategy swapToPt steps for the same prompt.` : `- PT/YT/LP strategy loops are NOT available on this chain. Pendle is deposit-only here.`}`);
  }

  if (hasAerodrome) {
    sections.push(`AERODROME LP DEPOSITS:
- "deposit into Aerodrome" / "LP on Aerodrome" / "provide liquidity on Aero" → use deposit action with protocol "Aerodrome" in allocations.
- User may optionally name a pool (e.g. "USDC-WETH", "USDC-AERO"). Pass it as aerodromePool in the allocation. Default pool is USDC-WETH if not specified.
- Aerodrome deposits swap half to the paired token, add liquidity, and stake in the gauge automatically.`);
  }

  sections.push(buildAmountConversion(marketActions));

  sections.push(`GENERAL RULES:
- For deposit: allocations BPS must sum to 10000. If only one protocol, use bps: 10000.
- If the user gives explicit percentages for two or more protocols (e.g. "40% to ${protocols[0] ?? "Morpho"}, 20% to ${protocols[1] ?? "Aave"}") that do NOT sum to 100%, do NOT normalize/rescale them and do NOT invent an allocation for the remainder — refuse. Use a "refuse" reason in exactly this form so the frontend can offer a fix: "Your percentages (<list each, e.g. 40% + 20%>) add up to <total>%, not 100% — please give percentages that sum to 100%."
- For swapAndDeposit: set minUsdcOut to "0" (backend calculates slippage from live quote).
- For withdraw: use amountType to control how the amount is interpreted.
  - amountType "usdc": amount in USDC smallest units (6 decimals). "1 USDC" → amount: "1000000".
  - amountType "percent": 1-100. "withdraw 30%" → amount: "30".
  - amountType "all": withdraw everything. amount: "0".
  - amountType "shares": raw vault share units (only if user mentions shares).
  - Default to "usdc" for dollar amounts, "all" for "all" / "everything", "percent" for "half"/"30%".
- NEVER invent protocol names. Only use names from the registered list.
- If user mentions a non-USDC token for deposit, ALWAYS use swapAndDeposit.
- Always respond with ONLY valid JSON matching the schema. No markdown, no explanation.

WORD SYNONYMS — treat these as "deposit":
- "lend", "lend my", "lending", "earn yield", "put to work", "invest", "invest in", "put in", "allocate to", "supply" (without "collateral") = deposit`);

  if (marketActions) {
    sections.push(`WORD SYNONYMS — treat these as "leverage":
- "open Nx leverage on", "long Nx", "leverage into", "go Nx on" = leverage

WORD SYNONYMS — treat these as "strategy":
- "loop", "looping", "leveraged farming", explicit "repeat N times" = strategy
- "supply and borrow", "collateral and borrow", "borrow against" = strategy${hasPendle ? `
- "PT", "principal token", "fixed yield loop" on a Pendle market = strategy using swapToPt` : ""}

WORD SYNONYMS — treat these as "strategy" (swap USDC into another token):
- "swap X USDC to <token>", "convert USDC to <token>", "buy <token> with USDC" where <token> is a non-USDC token = strategy with a single swap step. Emit: { action: "strategy", inputToken: USDC address, inputAmount: X in 6 decimals, steps: [{ action: "swap", tokenIn: USDC, tokenOut: <token address>, bps: 10000 }] }. NEVER refuse these — they are valid single-step strategies.`);
  }

  sections.push(`WORD SYNONYMS — treat these as "bridge" (cross-chain, same token):
- "bridge X to <chain>", "send X to <chain>", "move X to <chain>", "transfer X to <chain>" = bridge
- "swap X from <chain> to <chain>" where BOTH are chains (not tokens) = bridge. The presence of "from <chain> to <chain>" signals a cross-chain move, even when the user says "swap".`);

  sections.push(buildRefusalRules(protocolNames, marketActions));

  sections.push(buildPayloadSchema(marketActions, hasPendle, hasAerodrome));

  return sections.join("\n\n");
}

function buildStrategySection(marketLabels: string): string {
  return `STRATEGY ACTION — USE THIS FOR:
- Leverage/looping positions: "leverage 3x on ETH", "loop WETH/USDC on Morpho"
- Multi-step supply+borrow combos: "supply WETH and borrow USDC against it"
- Any request involving supply collateral, borrow, repay, or withdraw collateral on Morpho Blue

STRATEGY SCHEMA:
strategy: {
  action: "strategy",
  inputToken: string (hex address),
  inputAmount: string (uint256 in smallest units),
  steps: [{ action: "swap"|"swapToPt"|"swapToYt"|"addLiquidityPendle"|"wrapLp"|"supplyCollateral"|"borrow"|"repay"|"withdrawCollateral", tokenIn: string, tokenOut?: string, bps: number (0-10000), amountFixed?: string, protocolData?: { marketId?: string, pendleMarket?: string, targetLtv?: number, withdrawAmount?: string, slippage?: number } }],
  targetLtv?: number (0-1),
  loops?: number (1-10)
}

STRATEGY RULES:
- CRITICAL: if the user's input token (e.g. USDC) is NOT the same as the collateral token for the market they want to supply to, you MUST emit a "swap" step FIRST to convert the input token into the collateral token BEFORE the supplyCollateral step.
- CRITICAL — TOKEN ORDERING: a step's tokenIn must already exist by that point in the sequence — either it's the strategy's own inputToken, or an EARLIER step produced it (a swap/wrapLp/swapToPt/swapToYt/addLiquidityPendle's tokenOut, or a borrow/withdrawCollateral's received token). NEVER supply, repay, or otherwise spend a token before the step that creates it. This is validated and rejected server-side if violated — get the order right the first time rather than emitting a plausible-looking but temporally impossible sequence.
- LOOP EXPANSION — emit the loop body ONCE and set "loops". For a request that repeats a borrow→swap→supply block N times, do NOT write the block N times. Instead:
  1. Emit the ENTRY steps once (the initial swap + supplyCollateral).
  2. Emit the LOOP BODY once (one borrow → swap → supplyCollateral).
  3. Set the top-level "loops" field to N (the number of repetitions the user asked for).
  The backend expands the loop body to exactly N iterations. This is REQUIRED — always set "loops" for any "loop N times" / "repeat N times" request.
- "wrapping" (e.g. WETH→wstETH) is a SWAP step, not a special action. Use action: "swap".
- Canonical leverage shape: entry (swap → supplyCollateral) + loop body (borrow → swap → supplyCollateral) emitted once, with loops set to the repeat count.
- marketId MUST be a "COLLATERAL-LOAN" symbol label (e.g. ${marketLabels}), or a bytes32 market id if the user gave one. NEVER leave marketId empty.
- CRITICAL FOR REPEATED/LOOPED STRATEGIES: set protocolData.marketId on EVERY supplyCollateral/borrow/repay/withdrawCollateral step, including every repetition of the loop body — not just the entry steps or the first iteration.
- Every borrow step MUST set protocolData.targetLtv (0-1). Also set the top-level targetLtv to the same value.
- bps: 10000 means "use 100% of the available balance of tokenIn". Use for swap and supply steps.
- tokenIn for borrow = the borrow token received (e.g. USDC address). tokenIn for supplyCollateral = the collateral token.
- A borrow can only be sized against collateral supplied to the SAME marketId earlier in the steps.`;
}

function buildPendleStrategySection(): string {
  return `PENDLE PT STRATEGIES (fixed-yield leverage):
- Use action "swapToPt" to buy a Pendle Principal Token (PT). Set tokenIn and protocolData.pendleMarket to the market label EXACTLY as named. Do NOT set tokenOut.
- Use action "swapToYt" to buy a Pendle Yield Token (YT). Same rules.
- Use action "addLiquidityPendle" to add liquidity to a Pendle market (buy LP). Same rules.
- For a standalone buy (just PT, just YT, or just LP without any Morpho steps): emit a single-step strategy with ONLY that step.
- For a PT collateral loop, Morpho steps MUST also set protocolData.pendleMarket. Do NOT set marketId for these.
- Canonical PT leverage shape: swapToPt → supplyCollateral → (borrow → swapToPt → supplyCollateral) repeated per loop.
- Emit every loop iteration explicitly. NEVER rely on "loops" to expand.
- swapToPt, swapToYt, and addLiquidityPendle are NOT "swapping out of USDC". Do NOT refuse them under that rule.
- wrapLp is EXCLUSIVELY for wrapping a Pendle LP token.`;
}

function buildAmountConversion(marketActions: boolean): string {
  return `AMOUNT CONVERSION — USDC has 6 decimals. Convert human amounts to smallest units:
- "1000 USDC" → "1000000000" (1000 × 10^6)
- "100 USDC" → "100000000"
- "10 USDC" → "10000000"
- "1 USDC" → "1000000"
- "0.5 USDC" → "500000"
- "0.1 USDC" → "100000"
- "0.01 USDC" → "10000"
- "0.001 USDC" → "1000"
CRITICAL: USDC is NOT 18 decimals. It is 6. Never multiply by 10^18.
A dollar amount means USDC: "$1" → "1000000", "invest $1" → deposit with amount "1000000".${
    marketActions
      ? `
For non-USDC tokens (WETH, wstETH, etc.) in strategy/leverage inputAmount: use that token's decimals.
- "1 WETH" → "1000000000000000000" (1 × 10^18)
- "0.1 WETH" → "100000000000000000"`
      : ""
  }`;
}

function buildRefusalRules(
  protocolNames: string,
  marketActions: boolean,
): string {
  const lines = [
    "REFUSE ONLY when:",
    `- User asks for a protocol NOT in the registered list above${marketActions ? " AND it's not a Morpho Blue market operation" : ""}`,
    `- NEVER refuse any of these — they are ALL valid: ${protocolNames}`,
    "- User names an unknown token WITHOUT providing its address",
  ];

  if (marketActions) {
    lines.push(
      `- User asks to SELL/CONVERT USDC into a non-USDC token as a standalone swap WITH NO SUBSEQUENT DEPOSIT/SUPPLY (e.g. "swap my USDC to ETH and send to my wallet" or "cash out to ETH") — the vault only accepts inflows TO USDC. NOTE: this rule does NOT apply to:`,
      "  - leverage (flash-loan USDC→collateral is internal)",
      "  - strategies (swap steps within a loop are internal)",
      "  - swapAndDeposit (non-USDC→USDC is the correct direction)",
      "  - CROSS-CHAIN bridges (the token stays USDC and only the chain changes — that is a bridge, not a refusal)",
      "  - Swapping USDC INTO another token for the PURPOSE OF supplying/depositing/collateral — this is a STRATEGY, not a refusal.",
    );
  } else {
    lines.push(
      "- User asks to SELL/CONVERT USDC into a non-USDC token (e.g. \"swap my USDC to ETH\", \"cash out to ETH\") — the vault only accepts inflows TO USDC. This chain has no strategy action, so there is no internal-swap exception. NOTE: this rule does NOT apply to:",
      "  - swapAndDeposit (non-USDC→USDC is the correct direction)",
      "  - CROSS-CHAIN bridges (the token stays USDC and only the chain changes — that is a bridge, not a refusal)",
      "- User asks to leverage, loop, borrow, or supply collateral — not available on this chain.",
    );
  }

  lines.push(
    '- "swap WETH to USDC", "convert WETH to USDC", "sell my ETH for USDC" = swapping INTO USDC = this is swapAndDeposit, NOT a refusal!',
    "- User asks to bridge non-USDC tokens",
    "- User asks to stake ETH natively or open perps",
    "- User gives explicit multi-protocol percentages that don't sum to 100% (see the deposit rule above for the exact refusal wording)",
  );

  return lines.join("\n");
}

function buildPayloadSchema(
  marketActions: boolean,
  hasPendle: boolean,
  hasAerodrome: boolean,
): string {
  const depositExtras = [
    hasPendle ? "pendleMarket?" : null,
    hasAerodrome ? "aerodromePool?" : null,
  ].filter(Boolean);
  const depositAlloc = ["protocol", "bps", ...depositExtras].join(", ");
  const withdrawEntry = ["protocol", "amount?", "amountType", ...depositExtras].join(", ");

  const lines = [
    "PAYLOAD SCHEMA:",
    `deposit: { action:"deposit", amount, allocations:[{ ${depositAlloc} }] }`,
    'swapAndDeposit: { action:"swapAndDeposit", inputToken, amount, minUsdcOut:"0", allocations:[{ protocol, bps }] }',
    `withdraw: { action:"withdraw", entries:[{ ${withdrawEntry} }] }`,
    'rebalance: { action:"rebalance", entries:[{ from, to, shares:"0" }] }',
    'bridge: { action:"bridge", amount, destChainId }',
    'claimWithdraw: { action:"claimWithdraw", requestId }',
    'cancelWithdraw: { action:"cancelWithdraw", requestId }',
  ];
  if (marketActions) {
    lines.push(
      "strategy: (see STRATEGY SCHEMA above)",
      'leverage: { action:"leverage", inputToken, collateralToken, inputAmount, multiplier, marketId? }',
    );
  }
  lines.push('refuse: { action:"refuse", reason }');
  return lines.join("\n");
}

function buildStableDistinction(chain: ChainInfo): string {
  const usdc = findToken(chain.chainKey, chain.loanToken);
  if (!usdc) return "";

  // Chains that carry a second, confusable dollar token need the distinction
  // spelled out; the rest just need the "deposit takes USDC only" rule.
  const lookalike = chain.tokens.find(
    (t) => t.stable && t.symbol !== usdc.symbol,
  );
  if (!lookalike) {
    return `CRITICAL — ${usdc.symbol} ONLY FOR "deposit":
- ${usdc.symbol} (${usdc.address}) is the ONLY token that can be used with "deposit" directly.
- Every other token goes through swapAndDeposit.`;
  }

  const others = chain.tokens
    .filter((t) => t.stable && t.symbol !== usdc.symbol)
    .map((t) => `${t.symbol} (${t.address})`)
    .join(", ");
  return `CRITICAL DISTINCTION — ${usdc.symbol} vs the other stablecoins on this chain:
- ${usdc.symbol} (${usdc.address}) is the ONLY token that can be used with "deposit" directly.
- ${others} are DIFFERENT tokens. They MUST use swapAndDeposit.
- The "deposit" action ONLY accepts ${usdc.symbol}. Every other token goes through swapAndDeposit.`;
}
