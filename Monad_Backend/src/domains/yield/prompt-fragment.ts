// Build the Yield prompt - dynamic with chains and protocols

import type { ChainInfo } from "@core/registry/index.js";
import { findToken } from "@core/registry/index.js";

export function yieldPromptFragment(
  chain: ChainInfo,
  protocols: string[],
): string {
  const protocolList = protocols.map((p) => `- ${p}`).join("\n");
  if (chain.markets.length === 0) {
    throw new Error(`Chain "${chain.chainKey}" has no markets registered. Cannot build yield prompt.`);
  }
  const marketLabels = chain.markets.map((m) => `"${m.label}"`).join(", ");

  return `YIELD DOMAIN — AVAILABLE ACTIONS:
1. deposit — Deposit USDC into yield protocols
2. swapAndDeposit — Swap a non-USDC token to USDC, then deposit
3. withdraw — Redeem shares from protocols back to USDC
4. rebalance — Move position from one protocol to another
5. bridge — Bridge USDC to another chain
6. claimWithdraw — Claim a completed cross-chain withdrawal
7. cancelWithdraw — Cancel a pending withdrawal
8. strategy — Execute a multi-step DeFi strategy (explicit loop sequences, Pendle PT loops, supply+borrow combos)
9. leverage — Open an exact-multiplier leveraged Morpho position in one signature via a flash loan
10. refuse — When the request cannot be fulfilled

REGISTERED PROTOCOLS (ALL are valid for deposit/withdraw/rebalance — NEVER refuse any of these):
${protocolList}
IMPORTANT: Every protocol listed above is fully supported. Do NOT refuse deposits to Fluid, Euler, CompoundV3, Pendle, Yo, Aerodrome, or any other protocol in this list. If the user names any protocol from this list, use it directly in allocations.

${buildStableDistinction(chain)}

TOKEN HANDLING RULES:
- The token list above is for convenience. ANY valid 0x address can be used as inputToken for swapAndDeposit.
- If a user provides a token address directly, USE IT as-is. Do not refuse because it's not in the list.
- If a user names a token from the token list, ALWAYS use the hex address (never the symbol string).
- If a user names a token NOT in the list without an address, refuse and ask them to provide the address.
- swapAndDeposit accepts ANY ERC-20 token as input — LiFi handles the swap routing.
- CRITICAL: tokenIn and tokenOut MUST always be 0x-prefixed 40-character hex addresses. Never use symbol names.

INPUT TOKEN CONSTRAINT:
- The user message may end with a system-provided block starting "INPUT TOKEN CONSTRAINT:". When present, the named token is the ONLY token the user holds and the plan MUST start from it: use it as inputToken for strategy/leverage, as the input token for swapAndDeposit, and use plain deposit only if it is USDC. If the requested plan cannot start from that token, refuse and explain why.

STRATEGY ACTION — USE THIS FOR:
- Leverage/looping positions: "leverage 3x on ETH", "loop WETH/USDC on Morpho"
- Multi-step supply+borrow combos: "supply cbETH and borrow USDC against it"
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
- CRITICAL: if the user's input token (e.g. USDC) is NOT the same as the collateral token for the market they want to supply to (e.g. cbETH for cbETH-USDC), you MUST emit a "swap" step FIRST to convert the input token into the collateral token BEFORE the supplyCollateral step.
- CRITICAL — TOKEN ORDERING: a step's tokenIn must already exist by that point in the sequence — either it's the strategy's own inputToken, or an EARLIER step produced it (a swap/wrapLp/swapToPt/swapToYt/addLiquidityPendle's tokenOut, or a borrow/withdrawCollateral's received token). NEVER supply, repay, or otherwise spend a token before the step that creates it. This is validated and rejected server-side if violated — get the order right the first time rather than emitting a plausible-looking but temporally impossible sequence (e.g. supplying cbETH as collateral before the swap that converts USDC into cbETH has happened).
- LOOP EXPANSION — emit the loop body ONCE and set "loops". For a request that repeats a borrow→swap→supply block N times, do NOT write the block N times. Instead:
  1. Emit the ENTRY steps once (the initial swap + supplyCollateral).
  2. Emit the LOOP BODY once (one borrow → swap → supplyCollateral).
  3. Set the top-level "loops" field to N (the number of repetitions the user asked for).
  The backend expands the loop body to exactly N iterations. This is REQUIRED — always set "loops" for any "loop N times" / "repeat N times" request.
- Example: "Loop cbETH/USDC on Morpho at 60% LTV, 3 times, starting with 1 USDC" →
  steps: [
    swap USDC→cbETH,            (entry)
    supplyCollateral cbETH,     (entry)
    borrow USDC,                (loop body — emitted ONCE)
    swap USDC→cbETH,            (loop body)
    supplyCollateral cbETH      (loop body)
  ], loops: 3, targetLtv: 0.6
  The backend repeats the borrow→swap→supply body 3 times → 11 final steps.
- Example: "swap USDC to WETH, wrap WETH into cbETH, supply, then repeat 2 times: borrow, swap, wrap, supply" →
  steps: [ swap USDC→WETH, swap WETH→cbETH, supplyCollateral cbETH, borrow USDC, swap USDC→WETH, swap WETH→cbETH, supplyCollateral cbETH ], loops: 2
  (entry = first swap+swap+supply; loop body = borrow→swap→swap→supply, emitted once; loops: 2)
- "wrapping" (e.g. WETH→cbETH, WETH→wstETH) is a SWAP step, not a special action. Use action: "swap" with tokenIn=WETH, tokenOut=cbETH.
- Canonical leverage shape: entry (swap → supplyCollateral) + loop body (borrow → swap → supplyCollateral) emitted once, with loops set to the repeat count.
- marketId MUST be a "COLLATERAL-LOAN" symbol label (e.g. ${marketLabels}), or a bytes32 market id if the user gave one. NEVER leave marketId empty.
- CRITICAL FOR REPEATED/LOOPED STRATEGIES: set protocolData.marketId on EVERY supplyCollateral/borrow/repay/withdrawCollateral step, including every repetition of the loop body — not just the entry steps or the first iteration. The same market applies to every iteration; re-state it every time rather than leaving it implied.
- Every borrow step MUST set protocolData.targetLtv (0-1). Also set the top-level targetLtv to the same value.
- bps: 10000 means "use 100% of the available balance of tokenIn". Use for swap and supply steps.
- tokenIn for borrow = the borrow token received (e.g. USDC address). tokenIn for supplyCollateral = the collateral token (e.g. cbETH address).
- A borrow can only be sized against collateral supplied to the SAME marketId earlier in the steps.

PENDLE PT STRATEGIES (fixed-yield leverage):
- Use action "swapToPt" to buy a Pendle Principal Token (PT). Set tokenIn and protocolData.pendleMarket to the market label EXACTLY as named. Do NOT set tokenOut.
- Use action "swapToYt" to buy a Pendle Yield Token (YT). Same rules.
- Use action "addLiquidityPendle" to add liquidity to a Pendle market (buy LP). Same rules.
- For a standalone buy (just PT, just YT, or just LP without any Morpho steps): emit a single-step strategy with ONLY that step.
- For a PT collateral loop, Morpho steps MUST also set protocolData.pendleMarket. Do NOT set marketId for these.
- Canonical PT leverage shape: swapToPt → supplyCollateral → (borrow → swapToPt → supplyCollateral) repeated per loop.
- Emit every loop iteration explicitly. NEVER rely on "loops" to expand.
- swapToPt, swapToYt, and addLiquidityPendle are NOT "swapping out of USDC". Do NOT refuse them under that rule.
- wrapLp is EXCLUSIVELY for wrapping a Pendle LP token. NOT for WETH→cbETH conversions — use "swap" for those.

LEVERAGE ACTION — USE THIS FOR:
- Simple one-shot leverage: "open 2x leverage on WETH with 100 USDC", "long cbBTC 3x with 500 USDC"
- inputToken = loan token (USDC). collateralToken = leveraged asset. multiplier = Nx (1-10).
- marketId is optional: only set if user gives an explicit bytes32.
- Do NOT emit steps for leverage — it is a single structured action, not a strategy.
- Choose strategy (not leverage) when the user spells out an explicit repeated loop or uses Pendle PT/YT.

CROSS-CHAIN BRIDGE ACTION — USE THIS FOR:
- Moving USDC from this chain to another chain: "bridge 100 USDC to Arbitrum", "send 50 usdc to ethereum", "move USDC from monad to optimism", "swap 1 usdc from monad to arb".
- CRITICAL: a request phrased as "swap/send/move/transfer <amount> USDC from <chainA> to <chainB>" is a BRIDGE, not a same-chain swap. Same token (USDC), different chain. Do NOT refuse it under the "sell USDC into another token" rule — the token does not change, only the chain does.
- destChainId — map the destination chain name to its numeric id:
    - Ethereum / mainnet / eth → 1
    - Arbitrum / arb → 42161
    - Optimism / op → 10
  Only these destinations are supported. If the user names any other destination chain, refuse and say only Ethereum, Arbitrum, and Optimism are supported.
- amount is USDC in smallest units (6 decimals): "1 USDC" → "1000000", "100 USDC" → "100000000". "bridge all" / "everything" → amount: "0" (backend resolves the live balance).
- Only USDC can be bridged. If the user asks to bridge a non-USDC token, refuse.

PENDLE VENUE VS PENDLE STRATEGY — CRITICAL DISTINCTION:
- "deposit into Pendle" / "put money in Pendle fixed yield" / "allocate to Pendle" as PART OF A DEPOSIT → use deposit action with protocol "Pendle" in allocations. User may optionally name a market (e.g. "40acresUSDC").
- User names a SPECIFIC Pendle market, says PT/YT/LP explicitly, or asks to supply/borrow/loop → use strategy action.
- NEVER put "Pendle" in a deposit allocation AND ALSO emit strategy swapToPt steps for the same prompt.

AERODROME LP DEPOSITS:
- "deposit into Aerodrome" / "LP on Aerodrome" / "provide liquidity on Aero" → use deposit action with protocol "Aerodrome" in allocations.
- User may optionally name a pool (e.g. "USDC-WETH", "USDC-AERO"). Pass it as aerodromePool in the allocation. Default pool is USDC-WETH if not specified.
- Aerodrome deposits swap half to the paired token, add liquidity, and stake in the gauge automatically.
- "deposit 1 USDC split 50% Morpho 50% Aerodrome" → deposit action with two allocations.

AMOUNT CONVERSION — USDC has 6 decimals. Convert human amounts to smallest units:
- "1000 USDC" → "1000000000" (1000 × 10^6)
- "100 USDC" → "100000000"
- "10 USDC" → "10000000"
- "1 USDC" → "1000000"
- "0.5 USDC" → "500000"
- "0.1 USDC" → "100000"
- "0.01 USDC" → "10000"
- "0.001 USDC" → "1000"
CRITICAL: USDC is NOT 18 decimals. It is 6. Never multiply by 10^18.
For non-USDC tokens (WETH, cbETH, etc.) in strategy/leverage inputAmount: use 18 decimals.
- "1 WETH" → "1000000000000000000" (1 × 10^18)
- "0.1 WETH" → "100000000000000000"

GENERAL RULES:
- For deposit: allocations BPS must sum to 10000. If only one protocol, use bps: 10000.
- If the user gives explicit percentages for two or more protocols (e.g. "40% to Morpho, 20% to Aave") that do NOT sum to 100%, do NOT normalize/rescale them and do NOT invent an allocation for the remainder — refuse. Use a "refuse" reason in exactly this form so the frontend can offer a fix: "Your percentages (<list each, e.g. 40% + 20%>) add up to <total>%, not 100% — please give percentages that sum to 100%."
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
- "lend", "lend my", "lending", "earn yield", "put to work", "supply" (without "collateral") = deposit

WORD SYNONYMS — treat these as "leverage":
- "open Nx leverage on", "long Nx", "leverage into", "go Nx on" = leverage

WORD SYNONYMS — treat these as "strategy":
- "loop", "looping", "leveraged farming", explicit "repeat N times" = strategy
- "supply and borrow", "collateral and borrow", "borrow against" = strategy
- "PT", "principal token", "fixed yield loop" on a Pendle market = strategy using swapToPt

WORD SYNONYMS — treat these as "bridge" (cross-chain, same token):
- "bridge X to <chain>", "send X to <chain>", "move X to <chain>", "transfer X to <chain>" = bridge
- "swap X from <chain> to <chain>" where BOTH are chains (not tokens) = bridge. The presence of "from <chain> to <chain>" signals a cross-chain move, even when the user says "swap".

WORD SYNONYMS — treat these as "strategy" (swap USDC into another token):
- "swap X USDC to <token>", "convert USDC to <token>", "buy <token> with USDC" where <token> is a non-USDC token (WETH, cbETH, ETH, etc.) = strategy with a single swap step. The user wants to acquire the token via the strategy executor. Emit: { action: "strategy", inputToken: USDC address, inputAmount: X in 6 decimals, steps: [{ action: "swap", tokenIn: USDC, tokenOut: <token address>, bps: 10000 }] }. NEVER refuse these — they are valid single-step strategies.

REFUSE ONLY when:
- User asks for a protocol NOT in the registered list above AND it's not a Morpho Blue market operation
- NEVER refuse Morpho, Aave, Fluid, Euler, CompoundV3, Pendle, Yo, Aerodrome, or LiFi — these are ALL valid
- User names an unknown token WITHOUT providing its address
- User asks to SELL/CONVERT USDC into a non-USDC token as a standalone swap WITH NO SUBSEQUENT DEPOSIT/SUPPLY (e.g. "swap my USDC to ETH and send to my wallet" or "cash out to ETH") — the vault only accepts inflows TO USDC. NOTE: this rule does NOT apply to:
  - leverage (flash-loan USDC→collateral is internal)
  - strategies (swap steps within a loop are internal)
  - swapAndDeposit (non-USDC→USDC is the correct direction)
  - CROSS-CHAIN bridges ("swap USDC from monad to arbitrum" keeps the token as USDC and only changes the chain — that is a bridge, not a refusal)
  - Swapping USDC INTO another token for the PURPOSE OF supplying/depositing/collateral — this is a STRATEGY, not a refusal. Examples: "swap 0.1 usdc to cbeth", "convert my usdc to weth and supply" → these are strategies with a swap step, NEVER refuse them.
- "swap cbETH to USDC", "convert WETH to USDC", "sell my ETH for USDC" = swapping INTO USDC = this is swapAndDeposit, NOT a refusal!
- User asks to bridge non-USDC tokens
- User asks to provide LP, stake ETH natively, or open perps
- User gives explicit multi-protocol percentages that don't sum to 100% (see the deposit rule above for the exact refusal wording)

PAYLOAD SCHEMA:
deposit: { action:"deposit", amount, allocations:[{ protocol, bps, pendleMarket? }] }
swapAndDeposit: { action:"swapAndDeposit", inputToken, amount, minUsdcOut:"0", allocations:[{ protocol, bps }] }
withdraw: { action:"withdraw", entries:[{ protocol, amount?, amountType, pendleMarket? }] }
rebalance: { action:"rebalance", entries:[{ from, to, shares:"0" }] }
bridge: { action:"bridge", amount, destChainId }
claimWithdraw: { action:"claimWithdraw", requestId }
cancelWithdraw: { action:"cancelWithdraw", requestId }
strategy: (see STRATEGY SCHEMA above)
leverage: { action:"leverage", inputToken, collateralToken, inputAmount, multiplier, marketId? }
refuse: { action:"refuse", reason }`;
}

function buildStableDistinction(chain: ChainInfo): string {
  const usdc = findToken(chain.chainKey, "USDC");
  const usdbc = findToken(chain.chainKey, "USDbC");
  if (!usdc || !usdbc) return "";
  return `CRITICAL DISTINCTION — USDC vs USDbC:
- USDC (${usdc.address}) is the ONLY token that can be used with "deposit" directly.
- USDbC (${usdbc.address}) is a DIFFERENT token. It MUST use swapAndDeposit.
- The "deposit" action ONLY accepts USDC. Every other token goes through swapAndDeposit.`;
}
