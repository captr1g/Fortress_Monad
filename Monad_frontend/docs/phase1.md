# Phase 1 — Production DeFi Agent

## System Overview

The system is a natural-language DeFi execution agent that takes user prompts (e.g., "Swap 1 ETH to USDC on Base"), interprets them with GPT-4o function calling, resolves on-chain data (routes, markets, balances), builds unsigned transactions, simulates them on a Tenderly fork, and returns a rich preview — all before the user commits to signing. On confirmation, it re-quotes with drift protection and returns ordered artifacts for wallet signing.

- **Supported chains:** Ethereum (1), Base (8453), Arbitrum (42161)
- **Core principle:** Prompt → Plan → Resolve → Build → Simulate → Execute

---

## Architecture

### Pipeline Flow

```
User Prompt
  │
  ▼
POST /plan { prompt, walletAddress, chainId }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Planner (GPT-4o function calling)                               │
│   • System prompt with token addresses, market IDs, rules       │
│   • Returns tool_calls: [{toolId, args}, ...]                   │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Pipeline Engine (executePipeline)                                │
│   1. RESOLVE — each tool fetches external data (LiFi routes,    │
│      Morpho markets/vaults)                                     │
│   2. VALIDATE — balance checks, LTV checks, slippage limits     │
│      (skipped on /plan, used on /validate)                      │
│   3. BUILD — encode calldata, check allowances, produce         │
│      ExecutionArtifact[]                                        │
│   4. SIMULATE — Tenderly bundle simulation per chain            │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ Preview Response                                                 │
│   { planId, humanSummary, simulation, artifacts, previewCards } │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
User clicks Confirm → POST /execute { planId }
  │
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ QuoteRefresher                                                   │
│   • Re-resolves LiFi tools with fresh quotes                    │
│   • Rejects if output drifts > 2%                               │
│   • Non-LiFi tools: rebuilds without re-quoting                 │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
Executor returns sorted artifacts → Wallet signs sequentially
```

### Layer Diagram

```
┌───────────────────────────────────────────────────────────────────┐
│ API Layer                                                         │
│   server.ts (Fastify + CORS + JSON bigint serialization)         │
│   routes.ts (/plan, /validate, /simulate, /execute)              │
│   schemas.ts (Zod request validation)                            │
│   rate-limit.ts (60 req/min per IP, in-memory sliding window)   │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Agents                                                            │
│   planner/   — GPT-4o with tool_choice: "required"               │
│   executor/  — Sorts artifacts by kind, returns for signing      │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Core                                                              │
│   types.ts      — Plan, ToolCall, ExecutionArtifact, SimResult,  │
│                   Preview, PreviewCard, BalanceChange             │
│   tool.ts       — Tool<TArgs, TResolved> interface               │
│   pipeline.ts   — executePipeline() orchestrator                 │
│   registry.ts   — ToolRegistry + toOpenAIFunctions()             │
│   context.ts    — PipelineContext (client, wallet, getClient)    │
│   clients.ts    — ChainClients (viem PublicClient per chain)     │
│   store.ts      — PlanStore (in-memory, 15-min TTL, auto-evict) │
│   errors.ts     — PipelineError (stage, category, message)       │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Tools                                                             │
│   lifi/swap.ts          — Same-chain token swap                  │
│   lifi/bridge.ts        — Cross-chain bridge                     │
│   morpho/lend.ts        — Vault deposit (ERC4626)                │
│   morpho/supplyBorrow.ts — Supply collateral + borrow (direct)   │
│   morpho/multiply.ts    — Leverage (DISABLED, not registered)    │
│   aave/supply.ts        — Aave supply (registered separately)    │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Protocols                                                         │
│   lifi.ts     — LiFiAdapter (getBestRoute, getSwapCalldata)      │
│   morpho.ts   — MorphoAdapter (getVaults, getMarket, getPosition,│
│                 buildSupplyBundle, buildSupplyBorrowBundle)       │
│   paraswap.ts — Paraswap v6.2 swap calldata (multiply, disabled) │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Simulators                                                        │
│   types.ts      — Simulator interface                            │
│   tenderly.ts   — TenderlySimulator (bundle API, revert decode) │
│   router.ts     — SimulationRouter (multi-simulator dispatch)    │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────┐
│ Services                                                          │
│   market-registry.ts  — Live Morpho markets from GraphQL         │
│   quote-refresher.ts  — Re-quote LiFi with drift protection     │
│   gas-estimator.ts    — baseFee × gasUsed = gasCostNative        │
└───────────────────────────────────────────────────────────────────┘
```

### Multi-Chain Support

- **ChainClients:** Creates a `viem` `PublicClient` per configured chain (Ethereum, Base, Arbitrum). Backed by user-provided RPC URLs.
- **PipelineContext.getClient(chainId):** Any tool can read from any chain regardless of the request's primary `chainId`. Used by the bridge tool to check source-chain allowances.
- **Tenderly simulation:** Groups artifacts by `chainId`, simulates each chain's artifacts as a separate bundle, then merges results.
- **Artifact ordering:** Executor sorts artifacts: approvals (0) → evmBundle (1) → evmTx (2) → signedAction (3).

---

## Active Tools (Phase 1)

The agent currently registers and exposes three capabilities:

| Tool | Status | Description |
|------|--------|-------------|
| `lifi.swap` | ✅ Live | Same-chain token swap (ETH/Base/Arbitrum) |
| `lifi.bridge` | ✅ Live | Cross-chain bridge (5 chains) |
| `morpho.lend` | ✅ Live | Vault deposit, auto-selects best APY vault |
| `morpho.supplyBorrow` | ✅ Live | Supply collateral + borrow via direct Morpho Blue calls |
| `morpho.multiply` | ⛔ Disabled | Leverage — not registered (Bundler3 execution pending) |

`morpho.multiply` and the Paraswap protocol adapter remain in the codebase but are
**not registered** in `src/tools/index.ts`, so the planner will not route to them.

---

## User Flows

### Flow 1: Simple Swap

```
User: "Swap 1 ETH to USDC on Base"
  → Planner emits: lifi.swap { fromToken: 0x4200...0006, toToken: 0x8335...2913, amount: "1000000000000000000" }
  → Resolver: calls LiFi /v1/quote with chainId=8453, gets SwapRoute (toAmount, txData, approvalAddress)
  → Validator: checks ETH balance ≥ 1e18
  → Builder: if ERC20, checks allowance → approval artifact + evmTx artifact; if native, just evmTx
  → Simulator: Tenderly bundle simulation
  → Preview: "Swap 1000000000000000000 of 0x4200...0006 for 0x8335...2913 via LiFi with 0.5% slippage."
```

### Flow 2: Cross-Chain Bridge

```
User: "Bridge 100 USDC from Ethereum to Base"
  → Planner emits: lifi.bridge { fromToken: 0xA0b8...eB48, toToken: 0x8335...2913, fromChainId: 1, toChainId: 8453, amount: "100000000" }
  → Resolver: calls LiFi /v1/quote with fromChain=1, toChain=8453
  → Validator: no-op (cross-chain balance checks unreliable)
  → Builder: checks source-chain allowance via ctx.getClient(fromChainId), builds approval + evmTx on source chain
  → Simulator: Tenderly simulates source-chain transactions only
  → Preview: "Bridge 100000000 from chain 1 to chain 8453 via LiFi."
```

### Flow 3: Morpho Lend

```
User: "Lend 1000 USDC to the best Morpho vault"
  → Planner emits: morpho.lend { asset: 0x8335...2913, amount: "1000000000" }
  → Resolver: queries Morpho GraphQL for vaults accepting USDC on Base
     Filters: TVL > $100k (100000 × 1e6 raw), APY < 1000% (10.0)
     Sorts: highest APY, TVL as tiebreaker
  → Validator: checks USDC balance ≥ amount
  → Builder: checks allowance → approval artifact (if needed) + ERC4626 deposit(assets, receiver) evmTx
  → Simulator: Tenderly simulation
  → Preview: 'Lend 1000000000 of 0x8335...2913 to Morpho vault "Vault Name" at 5.23% APY.'
```

### Flow 4: Morpho Supply & Borrow

```
User: "Supply 0.01 WETH as collateral and borrow 10 USDC on Morpho"
  → Planner emits: morpho.supplyBorrow { marketId: "0x8793c...1bda", collateralAmount: "10000000000000000", borrowAmount: "10000000" }
  → Resolver: fetches market via Morpho GraphQL (collateralAsset, borrowAsset, lltv, oracle, irm)
  → Validator: skipped on /plan (Morpho Blue enforces LLTV on-chain)
  → Builder: direct Morpho Blue calls (no bundler, no authorization):
     • Tx 1: approve(MorphoBlue, collateralAmount) on collateral token
     • Tx 2: morpho.supplyCollateral(marketParams, collateralAmount, user, "0x")
     • Tx 3: morpho.borrow(marketParams, borrowAmount, 0, user, user)
  → Simulator: Tenderly bundle simulation (all 3 txs in sequence)
  → Preview: "Supply 10000000000000000 collateral and borrow 10000000 on Morpho Blue market."
  → Wallet signs the 3 txs in order.
```

### Flow 5: Morpho Multiply (Leverage) — DISABLED

```
The multiply tool is implemented (src/tools/morpho/multiply.ts) using an atomic
Bundler3 flashloan + Paraswap swap + supplyCollateral + borrow loop, but is NOT
registered. On-chain execution of the Bundler3 reenter callback is still being
finalized, so multiply prompts will not route. The code is preserved for the next
phase.
```

### Flow 6: Execution

```
User clicks Confirm → POST /execute { planId }
  → Retrieves StoredPlan from PlanStore (15-min TTL)
  → QuoteRefresher:
     • For LiFi tools: re-resolves with fresh quote, compares toAmount
     • If |drift| > 2%: throws "Quote expired" error
     • For non-LiFi tools: rebuilds artifacts without re-quoting
  → Executor: sorts artifacts by kind (approval → evmBundle → evmTx → signedAction)
  → Returns { planId, artifacts[] } for wallet to sign sequentially
```

---

## LiFi Integration

### lifi.swap

| Property | Value |
|----------|-------|
| **Tool ID** | `lifi.swap` |
| **Capability** | SWAP |
| **Chains** | Ethereum (1), Base (8453), Arbitrum (42161) |
| **Schema** | `{ fromToken, toToken, amount, slippage? }` |
| **Default slippage** | 0.5% (0.005) |
| **Max slippage** | 5% (0.05) |

**Resolver:** Calls LiFi `GET https://li.quest/v1/quote` with `fromChain`, `toChain` (same), `fromToken`, `toToken`, `fromAmount`, `fromAddress`, `slippage`. Timeout: 10s.

**Validator:**
- Rejects slippage > 5%
- Checks token balance (native ETH via `getBalance`, ERC20 via `balanceOf`)

**Builder:**
- Smart approval: reads current allowance, only adds approval artifact if insufficient
- Native tokens skip approval entirely
- Produces: `[approval?] + [evmTx]`

### lifi.bridge

| Property | Value |
|----------|-------|
| **Tool ID** | `lifi.bridge` |
| **Capability** | BRIDGE |
| **Chains** | Ethereum (1), Base (8453), Arbitrum (42161), Optimism (10), Polygon (137) |
| **Schema** | `{ fromToken, toToken, fromChainId, toChainId, amount, slippage? }` |
| **Default slippage** | 0.5% (0.005) |

**Resolver:** Same LiFi `/v1/quote` endpoint but with different `fromChain` and `toChain` values.

**Validator:** No-op. Cross-chain balance checks are unreliable due to potential in-flight transactions.

**Builder:**
- Uses `ctx.getClient(fromChainId)` to check source-chain allowance
- All artifacts are tagged with `fromChainId` (source chain only)
- Produces: `[approval?] + [evmTx]`

### Supported LiFi Commands

```
# Same-chain swaps
Swap 1 ETH to USDC on Base
Swap 0.5 ETH for USDC on Ethereum
Swap 100 USDC to ETH on Arbitrum
Swap 1000 USDC to DAI on Base
Swap 0.1 WBTC to USDC on Ethereum

# Cross-chain bridges
Bridge 100 USDC from Ethereum to Base
Bridge 0.5 ETH from Base to Arbitrum
Bridge 1000 USDC from Arbitrum to Ethereum
Bridge 50 USDC from Ethereum to Optimism
Bridge 1 ETH from Base to Polygon
```

**Chain combinations supported for bridge:**
- Ethereum ↔ Base
- Ethereum ↔ Arbitrum
- Ethereum ↔ Optimism
- Ethereum ↔ Polygon
- Base ↔ Arbitrum
- Base ↔ Optimism
- Base ↔ Polygon
- Arbitrum ↔ Optimism
- Arbitrum ↔ Polygon

---

## Morpho Integration

### Dynamic Market Registry

- **Source:** Morpho GraphQL API (`https://blue-api.morpho.org/graphql`)
- **Query:** Top 20 markets ordered by `SupplyAssetsUsd DESC` for chains [1, 8453]
- **Refresh interval:** 5 minutes
- **Initialization:** Fetched at server startup (non-blocking — fails gracefully)
- **Injection:** `getMarketsForPrompt()` formats market data and injects into planner system prompt
- **Planner update:** `setMarketsPrompt()` called every 5 minutes with fresh market data

**Format injected into system prompt:**
```
Base (8453):
  - WETH/USDC (86.0% LLTV): 0x8793cf302b8ffd655ab97bd1c695dbd967807e8367a65cb2f4edaf1380ba1bda
    Collateral: WETH (0x4200000000000000000000000000000000000006), Borrow: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
```

### morpho.lend

| Property | Value |
|----------|-------|
| **Tool ID** | `morpho.lend` |
| **Capability** | LEND |
| **Chains** | Base (8453) |
| **Schema** | `{ asset: address, amount: string, vaultAddress?: address }` |

**Resolver:**
- If `vaultAddress` provided: looks up specific vault
- Otherwise: queries `getVaults(asset, chainId)` from Morpho GraphQL
- Filters: `totalSupply >= 100,000 USDC` (100000 × 1e6) AND `supplyApy < 10.0` (1000%)
- Sort: highest APY first, totalSupply as tiebreaker
- Fallback: if no vault passes both filters, relaxes to TVL-only, then all vaults

**Validator:** Checks ERC20 balance ≥ deposit amount

**Builder:** Smart allowance check → approval artifact + ERC4626 `deposit(assets, receiver)` evmTx

**Known issue:** Some curator vaults may reject deposits due to whitelist or deposit cap restrictions. The system cannot detect these restrictions before simulation.

### morpho.supplyBorrow

| Property | Value |
|----------|-------|
| **Tool ID** | `morpho.supplyBorrow` |
| **Capability** | SUPPLY_COLLATERAL |
| **Chains** | Base (8453) |
| **Schema** | `{ marketId: string, collateralAmount: string, borrowAmount: string }` |

**Resolver:** Fetches market details from Morpho GraphQL using `uniqueKey` filter (response field `marketId`).

**Validator:** Skipped on `/plan`. Morpho Blue enforces LLTV on-chain; cross-decimal LTV math is unreliable off-chain without the oracle price, so the borrow tx reverts on-chain if the position would be unhealthy.

**Builder:** Direct Morpho Blue calls — no bundler, no `setAuthorization` needed:
- Tx 1: `approve(MorphoBlue, collateralAmount)` on the collateral token (skipped if allowance sufficient)
- Tx 2: `morpho.supplyCollateral(marketParams, collateralAmount, user, "0x")`
- Tx 3: `morpho.borrow(marketParams, borrowAmount, 0, user, user)`

Morpho Blue on Base: `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb`

### morpho.multiply — DISABLED

| Property | Value |
|----------|-------|
| **Tool ID** | `morpho.multiply` |
| **Status** | Not registered (disabled) |
| **Chains** | Base (8453) |
| **Schema** | `{ marketId: string, collateralAmount: string, targetLeverage: number (min 1.01) }` |

Implemented as an atomic Bundler3 (`0x6BFd8137e702540E7A42B74178A4a49Ba43920C4`)
flashloan loop with the GeneralAdapter1 (`0xb98c948CFA24072e58935BC004a8A7b376AE746A`)
and ParaswapAdapter (`0x6abE8ABd0275E5564ed1336F0243A52C32562F71`). Flashloan amount
is computed price-aware (LiFi quote), Paraswap v6.2 calldata + offsets feed the swap.
On-chain execution of the Bundler3 reenter callback is still being finalized, so the
tool is **not registered** in `src/tools/index.ts`.

### Available Morpho Markets (Base)

These are the default fallback markets. Live markets are refreshed from GraphQL every 5 minutes:

| Market | LLTV | Collateral | Borrow |
|--------|------|------------|--------|
| WETH/USDC | 86.0% | WETH (0x4200000000000000000000000000000000000006) | USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| cbBTC/USDC | 86.0% | cbBTC (0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf) | USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| USDe/USDC | 91.5% | USDe (0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34) | USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |

### Supported Morpho Commands

```
# Lending
Lend 1000 USDC to Morpho
Lend 1000 USDC to the best Morpho vault
Lend 0.5 USDC to the Moonwell USDC vault on Morpho

# Supply & Borrow
Supply 0.01 WETH as collateral and borrow 10 USDC on Morpho
Supply 1 WETH as collateral and borrow 2000 USDC on Morpho
Deposit 0.005 cbBTC as collateral and borrow 50 USDC on Morpho

# Multiply — DISABLED (tool not registered)
```

---

## Services

### Market Registry

| Property | Value |
|----------|-------|
| **Class** | `MarketRegistry` |
| **Endpoint** | `https://blue-api.morpho.org/graphql` |
| **Query** | Top 20 markets by SupplyAssetsUsd DESC, chains [1, 8453] |
| **Refresh** | Every 5 minutes (setInterval) |
| **Timeout** | 10 seconds per request |
| **Error handling** | Silently fails — keeps stale data |

**Output:** Formatted string for planner system prompt, grouped by chain, showing collateral/borrow symbols, LLTV percentages, and full market IDs.

### Quote Refresher

| Property | Value |
|----------|-------|
| **Class** | `QuoteRefresher` |
| **Trigger** | Called during `POST /execute` |
| **Drift threshold** | 2% (0.02) |

**Behavior:**
- Iterates over stored `resolvedCalls`
- LiFi tools (`lifi.*`): re-resolves with fresh `tool.resolve()`, compares `route.toAmount`
- Non-LiFi tools: rebuilds with `tool.build()` using stored `resolved` data
- If `|freshAmount - storedAmount| / storedAmount > 0.02`: throws `PipelineError` with drift percentage

### Gas Estimator

| Property | Value |
|----------|-------|
| **Class** | `GasEstimator` |
| **Formula** | `gasUsed × block.baseFeePerGas` |
| **Usage** | Injected into `/simulate` response when sim succeeds and gasUsed > 0 |

**Note:** Only works post-simulation. The `/plan` endpoint returns `gasCostNative: 0n` because gas estimation requires simulation results first.

---

## Known Limitations

| Issue | Impact | Fix Needed |
|-------|--------|-----------|
| morpho.multiply disabled | Leverage not available; tool not registered | Finalize Bundler3 reenter callback execution and on-chain testing |
| Tenderly fork lag | Simulations may show reverts when the fork is slightly behind the real chain state | Expected behavior — real tx may still succeed |
| Vault selection may pick restricted vaults | ERC4626 deposit reverts on curator-restricted vaults with whitelists or caps | Need vault metadata filtering (curator restrictions, deposit caps) |
| No cross-chain execution orchestrator | Multi-chain plans (bridge + swap) can't auto-sequence | User must execute source and destination chains separately |
| gasCostNative often 0n | Tenderly doesn't return gas price info, only gas units | Gas estimator only enriches `/simulate` responses, not `/plan` |
| PlanStore is in-memory only | Server restart loses all stored plans | Plans expire in 15 minutes; no persistence layer |
| lifi.bridge has no validation | Cross-chain balance checks skipped | User could submit a bridge with insufficient balance — caught at wallet signing |
| Rate limiter is in-memory | Resets on server restart, no distributed state | Single-instance only |

---

## API Endpoints

### POST /plan

**Purpose:** Interpret a user prompt into DeFi actions, execute the full pipeline, return a preview.

**Request:**
```json
{
  "prompt": "Swap 1 ETH to USDC on Base",
  "walletAddress": "0x1234...abcd",
  "chainId": 8453
}
```

**Response:** `Preview` object with `planId`, `humanSummary`, `simulation`, `artifacts`, `previewCards`.

**Pipeline:** Plan → Resolve → Build (skip validation) → Simulate → Store → Return preview.

### POST /validate

**Purpose:** Re-run validation on a stored plan (balance checks, LTV checks).

**Request:**
```json
{ "planId": "uuid" }
```

**Response:** `{ valid: true, planId: "uuid" }`

**Errors:** 404 if plan not found/expired, 422 if validation fails.

### POST /simulate

**Purpose:** Re-simulate a stored plan with gas estimation.

**Request:**
```json
{ "planId": "uuid" }
```

**Response:** Updated `Preview` with fresh `simulation` including `gasCostNative`.

### POST /execute

**Purpose:** Refresh quotes (LiFi drift check), return ordered artifacts for wallet signing.

**Request:**
```json
{ "planId": "uuid" }
```

**Response:**
```json
{
  "planId": "uuid",
  "artifacts": [
    { "kind": "approval", "chainId": 8453, "tx": {...} },
    { "kind": "evmTx", "chainId": 8453, "tx": {...} }
  ]
}
```

### Error Format

All errors return:
```json
{
  "error": {
    "stage": "planner|resolver|validator|builder|simulator|executor|api",
    "category": "validation|resolution|build|simulation|timeout|unknown",
    "message": "Human-readable description",
    "details": {}
  }
}
```

- Zod validation errors → 400
- PipelineErrors with "not found" / "expired" → 404
- All other PipelineErrors → 422
- Unexpected errors → 500

### Rate Limiting

- 60 requests per minute per IP
- In-memory sliding window
- Returns 429 with error message when exceeded

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | — | GPT-4o function calling for plan interpretation |
| `OPENAI_MODEL` | No | `gpt-4o` | Model override (any OpenAI model with tool support) |
| `TENDERLY_ACCESS_KEY` | Yes | — | Tenderly API key for fork simulation |
| `TENDERLY_ACCOUNT_SLUG` | Yes | — | Tenderly account identifier |
| `TENDERLY_PROJECT_SLUG` | Yes | — | Tenderly project identifier |
| `RPC_BASE` | Yes | — | Base mainnet RPC URL |
| `RPC_ETH` | No | `""` | Ethereum mainnet RPC URL |
| `RPC_ARB` | No | `""` | Arbitrum mainnet RPC URL |
| `PORT` | No | `3000` | HTTP server port |

---

## Tech Stack

- **Runtime:** Node.js with TypeScript (ES modules)
- **Framework:** Fastify with `@fastify/cors`
- **LLM:** OpenAI SDK (GPT-4o, function calling with `tool_choice: "required"`)
- **On-chain:** viem (PublicClient, encodeFunctionData, erc20Abi)
- **Validation:** Zod schemas (request validation + tool param schemas)
- **Schema conversion:** `zod-to-json-schema` for OpenAI function parameters
- **Simulation:** Tenderly simulate-bundle API
- **DeFi protocols:** LiFi REST API, Morpho GraphQL API
- **Testing:** Vitest
- **Build:** TypeScript compiler (tsc)
