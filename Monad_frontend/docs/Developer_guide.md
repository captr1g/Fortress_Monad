 # P2D — Prompt-to-DeFi Developer Guide

## What is FORTRESS?

FORTRESS is a **Prompt-to-DeFi execution engine** on Base. A user describes a DeFi strategy in natural language, the system extracts structured intent via GPT-4o, builds atomic on-chain calldata, simulates it on Tenderly, and returns signable transactions. One prompt, one signature, atomic execution.

---

## System Architecture (30,000 ft)

```
                         +-------------------+
                         |   Next.js Frontend |
                         |   (React / wagmi)  |
                         +---------+---------+
                                   |
                          REST API (JSON)
                                   |
                         +---------v---------+
                         |   Fastify Backend  |
                         |   (TypeScript)     |
                         +---------+---------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
   +----------v---------+ +-------v--------+ +--------v--------+
   | Fortress Module     | | APY Service    | | Positions Svc   |
   | (plan/build/sim)    | | (rates/cache)  | | (dashboard)     |
   +----------+----------+ +-------+--------+ +--------+--------+
              |                    |                    |
              |          +---------v---------+         |
              |          | Postgres + Redis   |         |
              |          +-------------------+         |
              |                                        |
   +----------v-----------------------------------------v----------+
   |                      Base Mainnet (chain 8453)                 |
   |                                                               |
   |  FortVault  |  FortStrategyExecutor  |  MorphoExitExecutor    |
   |  CrossChainRouter  |  LiFiAdapter  |  Morpho/Swap Adapters   |
   +---------------------------------------------------------------+
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Solidity 0.8.20+, Foundry, OpenZeppelin 5.x, UUPS Proxies |
| Backend | TypeScript, Fastify 5, Viem, OpenAI SDK, Zod |
| Frontend | Next.js 14 (App Router), React, wagmi v2, TailwindCSS |
| Database | PostgreSQL 16 (market rates, positions, strategies) |
| Cache | Redis 7 (APY cache, position cache, session store, locks) |
| Simulation | Tenderly Bundle Simulation API |
| DEX Routing | LiFi Diamond (swaps + bridges) |
| DeFi Protocols | Morpho Blue, Aave V3, Moonwell (via ERC-4626) |
| Auth | Wallet signature (SIWE-style), httpOnly cookie sessions |

---

## Smart Contracts — What's Deployed

All contracts live on **Base Mainnet (8453)**.

| Contract | Address | Purpose |
|----------|---------|---------|
| FortVault (Proxy) | `0x1d19D3421a5a277201bEc3F596d61FB866284506` | Stateless deposit router (UUPS) |
| FortVault (Impl) | `0x364fbbe0cE0f0828c3D2CAEa284d6fcD85De25F9` | Implementation behind proxy |
| LiFiAdapter | `0x5460286d8C0B7d50Dd422c12De34944Eb081C138` | LiFi swap adapter for vault |
| CrossChainRouter | `0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739` | Cross-chain deposit/withdraw |
| FortStrategyExecutor (Proxy) | `0x09Acd25f4Cd57155C47edc4b82855b50Ba67ad0D` | Multi-step strategy engine |
| SwapStrategyAdapter | `0x70a0289Ee70e55E12e0DCBF36201F127E702872c` | DEX swap adapter for strategies |
| MorphoStrategyAdapter | `0xbd1232f17100D3A501419E0F67CD8b12DD673a2B` | Morpho supply/borrow adapter |
| MorphoExitExecutor | `0xa815D070175F5674E6869e6Aa4f050D62283FBc3` | Flash-loan position unwind |

### External Dependencies

| Name | Address |
|------|---------|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| LiFi Diamond | `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` |
| Morpho Blue | `0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb` |
| Aave V3 Pool (Base) | `0xA238Dd80C259a72e81d7e4664a9801593F98d1c5` |

---

## Contract Architecture

### 1. FortVault — Stateless Deposit Router

The vault **never custodies funds**. USDC balance = 0 after every tx. It's a dispatch layer:

- `deposit(entries[])` — Split USDC across registered protocols. Shares go directly to user.
- `withdraw(entries[])` — Redeem protocol shares back to USDC, sent directly to user.
- `rebalance(entries[])` — Atomic move: redeem from source → deposit into target.
- `swapAndDeposit(...)` — Swap any token → USDC via LiFi → split-deposit (BPS-based).

Protocol dispatch logic:
```
entry.data empty?
  YES → protocol.isERC4626? → YES → IERC4626.deposit(amount, user)
                             → NO  → IFortProtocol.depositFor(amount, user)
  NO  → IFortProtocolEx.depositFor(amount, user, data)
```

Registered protocols:
- **Morpho Moonwell USDC** (`0xc1256Ae...`) — ERC-4626
- **Aave V3 StataTokenV2 USDC** (`0xC768c5...`) — ERC-4626
- **LiFi** (via LiFiAdapter `0x5460...`) — Adapter (IFortProtocolEx)

### 2. FortStrategyExecutor — Atomic Multi-Step Engine

Executes an ordered array of DeFi steps in a single tx. Steps chain via balance reads.

```
executeStrategy(inputToken, inputAmount, steps[], deadline)
```

Each step routes to a registered adapter by `adapterId`:
- `0` = SwapStrategyAdapter (DEX swaps)
- `1` = MorphoStrategyAdapter (supply/borrow/repay/withdraw)

Step types: `SWAP`, `SUPPLY_COLLATERAL`, `BORROW`, `REPAY`, `WITHDRAW_COLLATERAL`

Key design:
- BORROW is "output-only" — no tokens flow from executor to adapter; adapter calls Morpho `onBehalf(user)` and routes borrowed funds back to executor.
- Borrow sizing is **on-chain**: backend passes a target LTV, adapter reads live oracle + collateral to compute exact borrow amount.
- Residuals sweep back to user at end.
- Max 30 steps per strategy.

### 3. MorphoExitExecutor — Flash-Loan Unwind

Single-signature exit from a Morpho leverage position:

```
exitPosition(ExitParams) → atomically:
  1. flashLoan(loanToken, flashAssets)
  2. repay caller's debt → frees collateral
  3. withdrawCollateral to this contract
  4. swap collateral → loanToken (allowlisted DEX)
  5. Morpho pulls flashAssets back (loan settled)
  6. sweep surplus to caller
```

Three modes:
- `FULL_TO_LOAN` — Close everything, return USDC
- `FULL_TO_COLLATERAL` — Repay debt, return remaining collateral
- `DELEVERAGE` — Partial repay to reduce LTV

Security: Transient storage commitment (EIP-1153), DEX allowlist, minLoanOut floor.

### 4. CrossChainRouter — Standalone Bridge

Completely separate from FortVault:
- `depositCrossChain(amount, destChainId, lifiData, deadline)` — Bridges USDC via LiFi.
- `initiateWithdraw(expectedUsdc, sourceChain, deadline)` — Records intent.
- `fulfillWithdraw(requestId, amount)` — Keeper settles.
- `claimWithdraw(requestId)` — User claims USDC.

### 5. Adapters

| Adapter | Role |
|---------|------|
| `LiFiAdapter` | Stateless swap adapter for FortVault. DEX allowlist + fromAmount override. |
| `SwapStrategyAdapter` | DEX swaps for FortStrategyExecutor. Supports exact + full-balance modes. |
| `MorphoStrategyAdapter` | Morpho Blue operations. On-chain LTV-based borrow sizing. |

---

## Backend Architecture

### Entry Point (`src/index.ts`)

Fastify server on port 3000. Registers:
- CORS + cookie parsing
- BigInt JSON serialization hook
- Rate limiter (60 req/min)
- Error handler (Zod validation → 400, PlannerRefusal → 422)
- Auth routes (`/auth/*`)
- Fortress routes (`/fortress/plan`, `/fortress/exit`, `/fortress/withdraw`, `/fortress/positions`, `/fortress/strategies`)
- APY service (background poller)
- Positions service (background poller)
- Strategies service (catalog seed + rate poller)

### Fortress Module (`src/fortress/`)

The core "prompt-to-DeFi" pipeline:

```
User Prompt
    ↓
[1] FortressPlanner (GPT-4o) → Intent JSON (Zod-validated)
    ↓
[2] Intent Router → { strategy | deposit | swapAndDeposit | withdraw | bridge }
    ↓
[3] CalldataBuilder / StrategyService → UnsignedTransaction[]
    ↓
[4] FortressSimulator (Tenderly) → SimulationResult
    ↓
[5] Response: { intent, description, transactions, simulation, apy }
```

#### Key Files

| File | Role |
|------|------|
| `helpers/planner.ts` | GPT-4o intent extraction. Massive system prompt with token addresses, protocol list, strategy rules. |
| `services/plan.service.ts` | Top-level orchestrator. Routes intents, attaches APY previews. |
| `services/strategy.service.ts` | Resolves Morpho markets (by label or uniqueKey), fetches oracle prices, calls StrategyBuilder, computes APY. |
| `services/morpho.service.ts` | Morpho Blue on-chain reads: position, market state, oracle price. GraphQL market lookup by token pair or uniqueKey. |
| `services/exit.service.ts` | Builds flash-loan unwind tx. Fetches LiFi unwind quote, encodes `exitPosition` calldata, simulates. |
| `helpers/strategy-builder.ts` | Encodes `executeStrategy` calldata. Projects state forward, fetches LiFi quotes sequentially, computes borrow ceilings. |
| `helpers/builder.ts` | Builds deposit/withdraw/rebalance/bridge calldata. Handles share conversion, approval txs. |
| `helpers/swap-resolver.ts` | Fetches LiFi swap/bridge data. |
| `helpers/simulator.ts` | Tenderly bundle simulation (state overrides for approvals). |
| `helpers/exit-math.ts` | Pure math: per-mode exit amounts (repay, withdraw, collateral to sell). |
| `helpers/apy.ts` | Net APY formula: `(collateralValue * collateralApy - debtValue * borrowApy) / equity` |
| `helpers/pricing.ts` | Oracle price fetching, LTV conversion helpers. |
| `helpers/strategy-validator.ts` | Pre-build validation of step sequences (market consistency, LTV bounds). |
| `utils/config.ts` | `FortressConfig` — all contract addresses, RPC, protocols loaded from env. |
| `utils/tokens.ts` | Base token symbol → address map (WETH, cbETH, cbBTC, USDC, etc.). |
| `utils/abi.ts` | ABI fragments for all contracts. |
| `utils/logger.ts` | Colored per-request structured logging. |

#### Intent Types (Zod Schema)

| Action | Description |
|--------|-------------|
| `deposit` | USDC into vault protocols. `{ amount, allocations[{ protocol, bps }] }` |
| `swapAndDeposit` | Swap any token → USDC → deposit. `{ inputToken, amount, minUsdcOut, allocations }` |
| `withdraw` | Redeem shares. `{ entries[{ protocol, amount, amountType }] }` |
| `rebalance` | Move between protocols. `{ entries[{ from, to, shares }] }` |
| `bridge` | Cross-chain USDC. `{ amount, destChainId }` |
| `strategy` | Multi-step atomic. `{ inputToken, inputAmount, steps[], targetLtv, loops }` |
| `claimWithdraw` | Claim cross-chain withdrawal. `{ requestId }` |
| `cancelWithdraw` | Cancel pending withdrawal. `{ requestId }` |
| `refuse` | Cannot fulfill request. `{ reason }` |

#### Strategy Steps

Each step in a strategy:
```typescript
{
  action: "swap" | "supplyCollateral" | "borrow" | "repay" | "withdrawCollateral",
  tokenIn: "0x...",
  tokenOut?: "0x...",
  bps: 0-10000,          // % of current balance
  amountFixed?: string,  // exact amount (overrides bps)
  protocolData?: {
    marketId?: string,     // "cbETH-USDC" or bytes32
    targetLtv?: number,    // 0-1, for borrow sizing
    useFullBalance?: bool, // swap entire landed balance
    slippage?: number,     // 0-0.5
  }
}
```

---

### APY Service (`src/services/apy/`)

Resolves live yield rates for protocols. Two-tier cache (Redis → Postgres) with a freshness gate.

| File | Role |
|------|------|
| `resolver.ts` | `ApyResolver` — freshness-gated rate resolution. Auto-registers unknown markets. |
| `adapters/morpho.ts` | Morpho GraphQL API — supply/borrow APY + rewards. |
| `adapters/aave.ts` | Aave V3 on-chain `getReserveData` multicall → supply/borrow rates. |
| `adapters/staking.ts` | LST staking yields from DefiLlama `chart/{poolId}` endpoint. |
| `cache/redis.ts` | Redis get/set for rates with TTL. |
| `db/queries.ts` | Postgres CRUD for `market_registry` and `market_rates`. |
| `math.ts` | Ray-to-APY conversion (Aave's 27-decimal ray format). |
| `vault-apy.ts` | Computes weighted deposit APY across vault protocol allocations. |
| `routes.ts` | HTTP endpoints for APY data (optional). |

Database schema:
```sql
market_registry: market_id, protocol(aave|morpho|staking), chain_id, name, reserve_address, market_key
market_rates: market_id, supply_apy, borrow_apy, rewards_apy, polled_at
```

### Positions Service (`src/services/positions/`)

Real-time leverage-position dashboard. Background poller keeps data fresh; reads never block.

| File | Role |
|------|------|
| `discovery.ts` | Morpho `userByAddress` GraphQL — finds wallet's markets with active positions |
| `multicall.ts` | Batched on-chain reads (collateral, debt, oracle price) via multicall3 |
| `service.ts` | Read: Redis → Postgres → discover. Write-through refresh + net APY enrichment. |
| `poller.ts` | 30s loop: re-reads known wallets on-chain, recomputes net APY, prunes stale. |
| `db.ts` | Postgres upserts for tracked_wallets + wallet_positions |
| `cache.ts` | Redis cache/lock helpers |

### Strategies Service (`src/fortress/strategies/`)

Curated strategy catalog with live APY tracking.

| File | Role |
|------|------|
| `catalog.ts` | Hardcoded strategy entries (prompts, titles, summaries) |
| `strategies.service.ts` | Seed (build once via planner), refresh rates (poller), list (read) |
| `poller.ts` | Periodically re-prices all seeded strategies from fresh market rates |
| `db.ts` | Postgres persistence for strategy builds + rate snapshots |
| `index.ts` | Service initialization + route wiring |

### Auth Service (`src/services/auth/`)

Wallet-based authentication (SIWE-style):

```
1. POST /auth/nonce → { nonce }           (stored in Redis, 5min TTL)
2. User signs: "Sign in to Fortress\n\nNonce: {nonce}\nAddress: {address}"
3. POST /auth/verify → httpOnly cookie     (session stored in Redis, 7d TTL)
4. GET /auth/me → { authenticated, walletAddress }
5. POST /auth/logout → clears session
```

---

## Frontend Architecture

Next.js 14 (App Router) + wagmi v2 + TailwindCSS. Single-page dashboard at `/`.

### Components

| Component | Role |
|-----------|------|
| `page.tsx` | Main page. Orchestrates all panels + chat flow. |
| `ChatInput` | Natural language prompt input |
| `PipelineStages` | Visual pipeline indicator (extracting → building → simulating) |
| `PreviewCard` | Shows the built plan with APY, simulation result, confirm/reject buttons |
| `ErrorDisplay` | Formatted error rendering |
| `PositionsPanel` | Dashboard of open Morpho positions with exit buttons |
| `StrategiesPanel` | Curated strategy cards with live net APY + "Try" buttons |
| `WithdrawPanel` | Vault withdrawal UI (for ERC-4626 protocol positions) |
| `WalletConnect` | Wallet connection button (wagmi) |
| `AuthGate` | Wraps content requiring authentication |
| `RawDataViewer` | Expandable JSON viewer for debugging |

### Hooks

| Hook | Role |
|------|------|
| `useAuth` | SIWE auth flow: nonce → sign → verify → session cookie |
| `useSignTransactions` | Sequential transaction signing with gas estimation + receipt waiting |

### Key Libraries

| Lib | Role |
|-----|------|
| `api.ts` | All backend API calls (plan, exit, positions, strategies, withdraw, auth) |
| `tokens.ts` | Token address → symbol/decimals mapping for display |
| `wagmi.ts` | Wagmi config (Base chain, connectors) |
| `types.ts` | Phase states for pipeline visualization |

### User Flow (Frontend)

```
1. Connect wallet → auto-authenticate (sign message)
2. Dashboard loads: positions (polled 10s) + strategies (polled 30s)
3. User types prompt OR clicks "Try" on a strategy card
4. Frontend calls POST /fortress/plan
5. Pipeline stages animate: extracting → building → simulating
6. Preview card shows: description, simulation status, APY, tx list
7. User clicks "Confirm" → useSignTransactions signs each tx sequentially
8. On success → refresh positions
```

---

## Complete User Flows

### Flow A: Deposit USDC into Yield Protocols

```
User: "Deposit 500 USDC into Morpho"
  → Planner: { action: "deposit", amount: "500000000", allocations: [{ protocol: "Morpho", bps: 10000 }] }
  → Builder: [approve(USDC, vault, 500M), vault.deposit([{key, amount, minSharesOut, data}])]
  → Simulate on Tenderly
  → Return 2 txs to frontend
  → User signs → USDC goes to Morpho vault, shares minted to user
```

### Flow B: Swap Non-USDC + Deposit

```
User: "Swap 1 WETH and deposit into Aave"
  → Planner: { action: "swapAndDeposit", inputToken: WETH, amount: "1000000000000000000", allocations: [{ protocol: "Aave", bps: 10000 }] }
  → SwapResolver: fetch LiFi quote (WETH→USDC)
  → Builder: [approve(WETH, vault, 1e18), vault.swapAndDeposit(...)]
  → Simulate → Return txs
```

### Flow C: Leverage Strategy (Main Flow)

```
User: "I have 100 USDC, leverage 3x on WETH via Morpho at 70% LTV"
  → Planner extracts:
    { action: "strategy", inputToken: USDC, inputAmount: "100000000",
      steps: [
        { action: "swap", tokenIn: USDC, tokenOut: WETH, bps: 10000 },
        { action: "supplyCollateral", tokenIn: WETH, protocolData: { marketId: "WETH-USDC" } },
        { action: "borrow", tokenIn: USDC, protocolData: { marketId: "WETH-USDC", targetLtv: 0.7 } },
        { action: "swap", tokenIn: USDC, tokenOut: WETH, bps: 10000 },
        { action: "supplyCollateral", tokenIn: WETH, protocolData: { marketId: "WETH-USDC" } },
        { action: "borrow", tokenIn: USDC, protocolData: { marketId: "WETH-USDC", targetLtv: 0.7 } },
        { action: "swap", tokenIn: USDC, tokenOut: WETH, bps: 10000 },
        { action: "supplyCollateral", tokenIn: WETH, protocolData: { marketId: "WETH-USDC" } },
      ],
      targetLtv: 0.7
    }

  → StrategyService:
    1. Resolve "WETH-USDC" → MorphoMarketParams (GraphQL lookup)
    2. Fetch oracle price for the market
    3. Fetch existing position (collateral/debt) for user
    4. StrategyBuilder projects state forward:
       - First swap: LiFi quote (USDC→WETH, real amount)
       - SupplyCollateral: project collateral balance
       - Borrow: compute amount from targetLtv × collateralValue × oraclePrice
       - Repeat for each loop iteration
    5. Encode Step[] with baked LiFi calldata + borrow ceilings
    6. Compute APY: collateral staking yield vs borrow cost

  → Builder outputs:
    tx1: approve(USDC, executor, amount)
    tx2: morpho.setAuthorization(morphoAdapter, true)  [if not already set]
    tx3: executor.executeStrategy(USDC, 100e6, steps[], deadline)

  → Simulate all 3 on Tenderly
  → Return { transactions, simulation, apy }
```

### Flow D: Exit / Unwind Position

```
User clicks "Close → USDC" on a position card
  → Frontend: POST /fortress/exit { walletAddress, market: bytes32, mode: "full_to_loan" }
  → ExitService:
    1. Read live position (collateral, debt) from Morpho
    2. Compute exit amounts (exit-math.ts)
    3. Fetch LiFi unwind quote (collateral → loanToken)
    4. Check if morphoExitExecutor is authorized
    5. Encode exitPosition(ExitParams) calldata
    6. Simulate

  → Return:
    tx1: morpho.setAuthorization(exitExecutor, true)  [if needed]
    tx2: exitExecutor.exitPosition(...)

  → User signs → flash loan closes the entire position atomically
```

### Flow E: Withdraw from Vault Protocol

```
User: "Withdraw 200 USDC from Morpho vault"
  → Frontend: POST /fortress/withdraw { walletAddress, tokenAddress: morphoVault, amount: "200000000", amountType: "usdc" }
  → WithdrawService:
    1. Convert USDC amount to shares (previewWithdraw)
    2. Build approve(shares, vault) + vault.withdraw(entries[])
    3. Simulate

  → Return txs → User signs
```

### Flow F: Cross-Chain Bridge

```
User: "Bridge 1000 USDC to Arbitrum"
  → Planner: { action: "bridge", amount: "1000000000", destChainId: 42161 }
  → PlanService:
    1. Fetch LiFi bridge data (Base USDC → Arb USDC)
    2. Build: approve(USDC, router) + router.depositCrossChain(amount, 42161, lifiData, deadline)
    3. Simulate

  → User signs → USDC bridged via LiFi → keeper tracks completion
```

---

## API Reference

Base URL: `http://localhost:3000`

### POST /fortress/plan

Build signable transactions from a natural language prompt.

```json
// Request
{ "prompt": "...", "walletAddress": "0x..." }

// Response
{
  "intent": { "action": "strategy", "..." },
  "description": "Execute 5-step leverage strategy (2 loops at 70% LTV)",
  "transactions": [{ "to": "0x...", "data": "0x...", "value": "0", "chainId": 8453 }],
  "simulation": { "success": true, "gasUsed": "228265", "error": null },
  "apy": { "status": "ok", "netApy": { "value": 0.013, "status": "ok" }, "..." },
  "depositApy": { "status": "ok", "netApy": 0.05, "legs": [...] }
}
```

### GET /fortress/positions?walletAddress=0x...

Dashboard feed. Redis → Postgres → discover on first touch.

```json
{
  "positions": [{
    "wallet": "0x...", "marketKey": "0x...",
    "collateralToken": "0x...", "loanToken": "0x...",
    "collateral": "57300", "debt": "1500705",
    "collateralValue": "3437853", "ltv": 0.437, "lltv": 0.86,
    "netApy": -0.0376, "updatedAt": "..."
  }],
  "asOf": "...", "stale": false
}
```

### POST /fortress/positions/refresh

Force re-read from chain. Call after wallet connects or after tx confirms.

### POST /fortress/exit

Build the exit transaction for a Morpho position.

```json
// Request
{ "walletAddress": "0x...", "market": "0x...(bytes32)", "mode": "full_to_loan", "targetLtv": 0.5 }

// Response
{
  "description": "Close position (44% LTV) → receive USDC",
  "transactions": [...],
  "simulation": { "success": true, "gasUsed": "412300", "error": null },
  "position": { "collateral": "57300", "debt": "1500705", "ltv": 0.437, "..." },
  "settlement": { "mode": "full_to_loan", "debtRepaid": "1500705", "collateralSold": "57300", "expectedReceive": "1935000", "..." }
}
```

### POST /fortress/withdraw

Build vault protocol withdrawal transaction.

```json
// Request
{ "walletAddress": "0x...", "tokenAddress": "0xc1256...", "amount": "200000000", "amountType": "usdc" }

// Response
{ "description": "...", "protocol": "Morpho", "shares": "...", "transactions": [...], "simulation": {...} }
```

### GET /fortress/strategies

Curated strategy catalog with live APY.

```json
{
  "strategies": [{
    "id": "cbeth-loop-2x-50", "title": "cbETH 2-loop leverage (35% LTV)",
    "summary": "...", "prompt": "...",
    "status": "ok", "leverage": 1.54, "netApy": 0.013,
    "collateralApy": 0.027, "borrowApy": 0.048
  }],
  "asOf": "..."
}
```

### Auth Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/nonce` | POST | Request signing nonce |
| `/auth/verify` | POST | Verify signature, create session |
| `/auth/me` | GET | Check current session |
| `/auth/logout` | POST | Destroy session |

---

## Infrastructure & Configuration

### Docker (docker-compose.yml)

```yaml
services:
  postgres: PostgreSQL 16 (port 5432, auto-runs migrations)
  redis: Redis 7 (port 6379)
```

### Environment Variables

```env
# Core
OPENAI_API_KEY=             # GPT-4o for intent extraction
OPENAI_MODEL=gpt-4o
PORT=3000

# RPC
RPC_BASE=                   # Base mainnet (Alchemy/Infura)
RPC_ETH=                    # Ethereum mainnet (optional)
RPC_ARB=                    # Arbitrum mainnet (optional)

# Simulation
TENDERLY_ACCESS_KEY=
TENDERLY_ACCOUNT_SLUG=
TENDERLY_PROJECT_SLUG=

# External
LIFI_API_KEY=               # LiFi aggregator API key

# APY Service
APY_DATABASE_URL=           # Postgres connection string
APY_REDIS_URL=              # Redis connection string
APY_POLL_INTERVAL_MS=60000
APY_MAX_STALENESS_MS=300000

# Positions Service
POSITIONS_POLL_INTERVAL_MS=30000
POSITIONS_CACHE_TTL_SECONDS=60
POSITIONS_STALE_MS=60000
POSITIONS_WALLET_TTL_DAYS=7

# Aave
AAVE_POOL_BASE=0xA238Dd80C259a72e81d7e4664a9801593F98d1c5

# FORTRESS Contracts (Base Mainnet)
FORTRESS_VAULT=0x1d19D3421a5a277201bEc3F596d61FB866284506
FORTRESS_CROSS_CHAIN_ROUTER=0x7D15b7fe74810EBBA1a153A4Bf732d8Ee85B3739
FORTRESS_USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
FORTRESS_LIFI_DIAMOND=0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE
FORTRESS_CHAIN_ID=8453
FORTRESS_STRATEGY_EXECUTOR=0x09Acd25f4Cd57155C47edc4b82855b50Ba67ad0D
FORTRESS_MORPHO_ADAPTER=0xbd1232f17100D3A501419E0F67CD8b12DD673a2B
FORTRESS_SWAP_ADAPTER=0x70a0289Ee70e55E12e0DCBF36201F127E702872c
FORTRESS_MORPHO_EXIT_EXECUTOR=0xa815D070175F5674E6869e6Aa4f050D62283FBc3
FORTRESS_MORPHO_BLUE=0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
```

### Running Locally

```bash
# 1. Start infra
docker-compose up -d

# 2. Backend
cp .env.example .env   # fill in keys
npm install
npm run dev            # tsx watch src/boot.ts

# 3. Frontend
cd frontend
npm install
npm run dev            # Next.js on port 3001

# 4. Tests (backend)
npm run typecheck         # tsc --noEmit (type safety)
npm test                  # fast tier: unit/property/fuzz/regression/snapshot (~2s)
npm run test:integration  # real-call tier: OpenAI/Tenderly/LiFi/Morpho/Pendle/Redis/PG (~65s)
npm run test:all          # both tiers

# 5. Contracts (build/test)
cd Contracts
forge build
forge test --match-path "test/unit/*" -vvv
BASE_RPC_URL=... forge test --match-path "test/fork/*" -vvv
```

---

## What's Built (Status Quo)

### Smart Contracts (All Deployed & Verified on Base)

- [x] FortVault — deposit, withdraw, rebalance, swapAndDeposit
- [x] LiFiAdapter — stateless swap adapter for vault
- [x] CrossChainRouter — deposit/withdraw bridge via LiFi
- [x] FortStrategyExecutor — multi-step atomic execution engine
- [x] SwapStrategyAdapter — DEX swaps (exact + full-balance modes)
- [x] MorphoStrategyAdapter — Morpho Blue supply/borrow (on-chain LTV sizing)
- [x] MorphoExitExecutor — flash-loan position unwind (3 exit modes)
- [x] Full test suite (unit, fuzz, fork tests)

### Backend (Fully Functional)

- [x] GPT-4o intent extraction with comprehensive prompt engineering
- [x] All intent types: deposit, swapAndDeposit, withdraw, rebalance, bridge, strategy
- [x] Strategy pipeline: market resolution → oracle read → LiFi quote → calldata encode → simulate
- [x] Exit pipeline: position read → exit math → unwind quote → simulate
- [x] Withdraw pipeline: share conversion → calldata → simulate
- [x] APY service with adapters (Morpho GraphQL, Aave on-chain, staking via DefiLlama)
- [x] Positions service with background poller + net APY enrichment
- [x] Strategies catalog service with live rate refresh
- [x] Wallet auth (nonce + signature + httpOnly cookie session)
- [x] Tenderly simulation for all transaction bundles
- [x] Rate limiting, error handling, BigInt serialization

### Frontend (Functional MVP)

- [x] Wallet connection (wagmi/RainbowKit)
- [x] Auth flow (SIWE-style sign-in)
- [x] Chat input with prompt submission
- [x] Pipeline stage visualization
- [x] Preview card (description, APY, simulation, confirm/reject)
- [x] Transaction signing (sequential with gas estimation)
- [x] Positions dashboard (polled, with exit buttons)
- [x] Strategies panel (curated cards with live APY)
- [x] Withdraw panel
- [x] Error display

---

## What's Next (Future Roadmap)

### Phase 1: Production Hardening

| Area | Task | Details |
|------|------|---------|
| Security | Audit preparation | Formal security review of all deployed contracts |
| Security | Rate-limit per wallet | Currently global 60/min; need per-wallet throttle |
| Security | Input sanitization | Harden planner prompt injection resistance |
| Backend | Error recovery | Graceful degradation when LiFi/Tenderly is down |
| Backend | Retry logic | Transient RPC failures, LiFi quote timeouts |
| Backend | Queue-based execution | Replace synchronous plan → build → simulate with job queue |
| Monitoring | APY alerting | Alert when staleness exceeds threshold |
| Monitoring | Position health alerts | Notify when positions approach liquidation LTV |
| Frontend | Mobile responsive | Current UI is desktop-first |
| Frontend | Better loading states | Skeleton loaders, optimistic updates |

### Phase 2: Protocol Expansion

| Feature | Description |
|---------|-------------|
| More Morpho markets | Support all active Morpho Blue markets on Base (not just cbETH/cbBTC/WETH) |
| Multi-chain strategies | Extend FortStrategyExecutor concept to Arbitrum/Optimism |
| Aave V3 strategies | Leverage/loop on Aave V3 (not just vault deposits) |
| Compound V3 integration | Register as vault protocol |
| Yearn/Beefy vaults | Higher-yield vault options |
| LP positions | Uniswap V3 / Aerodrome LP entry via strategy steps |
| Staking strategies | Native ETH staking + restaking (EigenLayer, etc.) |

### Phase 3: Advanced Strategy Features

| Feature | Description |
|---------|-------------|
| Auto-rebalance | Background keeper monitors positions, auto-deleverages at risk threshold |
| Stop-loss / take-profit | User sets LTV bounds; keeper exits when breached |
| DCA into strategies | Periodic recurring execution of a strategy prompt |
| Strategy sharing | User-created strategies shareable via link/embed |
| Backtesting | Historical simulation of strategy performance given past APYs |
| Strategy templates | Parameterized templates (e.g. "X-loop at Y% LTV on Z pair") |
| Gas optimization | Batch multiple user strategies into single multicall |
| Dynamic LTV adjustment | Adjust target LTV based on market volatility |

### Phase 4: Cross-Chain Expansion

| Feature | Description |
|---------|-------------|
| Multi-chain vault | FortVault deployed on Arbitrum, Optimism, Ethereum |
| Cross-chain strategies | Enter position on chain A using funds from chain B |
| Unified positions dashboard | Aggregate positions across all chains |
| Chain-abstracted prompts | "Deposit wherever yield is highest" → auto-select best chain |
| Keeper network | Decentralized keepers for cross-chain fulfillment |

### Phase 5: Governance & Tokenomics

| Feature | Description |
|---------|-------------|
| Protocol fee | Small performance/management fee on strategy execution |
| Governance token | Vote on protocol parameters, fee structure |
| Revenue sharing | Fee distribution to token holders / LPs |
| Insurance fund | Protocol-owned reserve for black-swan liquidation events |

### Phase 6: Advanced AI

| Feature | Description |
|---------|-------------|
| Strategy recommendation | AI suggests strategies based on user's risk profile + portfolio |
| Market sentiment analysis | Factor in on-chain signals, governance votes, whale movements |
| Natural language monitoring | "Alert me if my position gets above 80% LTV" |
| Conversational refinement | Multi-turn: "That's too risky, reduce to 2x leverage" |
| Portfolio optimization | Suggest rebalancing across all user positions |

---

## Security Model Summary

### On-Chain Security

| Mechanism | Applied To |
|-----------|-----------|
| UUPS Upgradeable (owner-only) | FortVault, FortStrategyExecutor |
| Ownable2Step (explicit acceptance) | FortVault, CrossChainRouter |
| Pausable | All contracts |
| ReentrancyGuard | All user-facing functions |
| DEX Allowlist | Vault, SwapAdapter, LiFiAdapter, ExitExecutor |
| fromAmount Override | LiFi swaps (prevent user-submitted inflation) |
| BPS Split (no dust) | swapAndDeposit (last entry gets remainder) |
| Approval Hygiene | Zero approvals after every swap |
| Transient Storage Commitment | MorphoExitExecutor flash callback |
| Balance Delta Check | CrossChainRouter (verify LiFi consumed USDC) |
| On-chain Borrow Sizing | MorphoStrategyAdapter (immune to swap slippage) |
| Borrow Ceiling + Min Floor | Guard against dust borrows and overflows |

### Backend Security

| Mechanism | Details |
|-----------|---------|
| Rate limiting | 60 req/min global |
| Zod validation | All request bodies validated |
| Tenderly simulation | Every plan simulated before returning to user |
| Intent validation | BPS sum check, protocol existence, market resolution |
| Wallet auth | httpOnly cookie, Redis-backed sessions |
| Error boundaries | PlannerRefusal (422), ZodError (400), unknown (500) |

---

## Key Design Decisions

1. **Stateless vault** — FortVault never holds user funds. No custodial risk, no TVL attack surface.

2. **On-chain borrow sizing** — Backend passes target LTV, adapter reads real oracle + collateral at execution time. Immune to MEV sandwich attacks on sizing.

3. **Sequential LiFi quotes** — StrategyBuilder fetches swap quotes one-by-one so each swap is sized off the REAL output of the previous one. No compounding estimation error.

4. **Tenderly simulation gating** — Every plan is simulated before returning to the user. Prevents obviously-failing transactions from being signed.

5. **Freshness-gated APY** — Rates are never fabricated. If stale or unavailable, the field is `null` and the frontend shows "—". No misleading numbers.

6. **Flash-loan exit** — MorphoExitExecutor uses Morpho's free flash loans (0% fee) so users don't need upfront capital to unwind.

7. **Full-balance swap mode** — Post-borrow swaps use the adapter's live balance (not a baked amount) because the exact borrow is decided on-chain and may differ from the build-time estimate.

8. **EIP-1153 transient storage** — MorphoExitExecutor uses transient storage for flash loan commitment to prevent callback replay across transactions.

---

## Project Structure (Key Directories)

```
/
├── Contracts/
│   ├── src/                    # Solidity source
│   │   ├── FortVault.sol
│   │   ├── FortStrategyExecutor.sol
│   │   ├── MorphoExitExecutor.sol
│   │   ├── CrossChainRouter.sol
│   │   ├── adapters/           # LiFi, Morpho, Swap adapters
│   │   └── interfaces/         # IFortProtocol, IStrategyAdapter, etc.
│   ├── script/                 # Foundry deploy scripts
│   ├── test/                   # unit/, fuzz/, fork/, mocks/, helpers/
│   └── foundry.toml
│
├── src/                        # Backend (TypeScript)
│   ├── boot.ts                 # Entry point: register chains + capabilities, wire API
│   ├── core/                   # Shared, chain-agnostic
│   │   ├── api/                # controllers, routes, middleware, serializers, server
│   │   ├── planner/            # LLM call, prompt-assembler, intent-envelope
│   │   ├── orchestrator.ts     # Route by domain → build → compile → simulate
│   │   ├── registry/           # capabilities, chains, types, index (lookups)
│   │   ├── ir/                 # ExecutionPlan, Operation types
│   │   └── services/           # apy/, positions/, strategies/, saved-strategies/, auth/
│   ├── domains/                # Business verticals
│   │   └── yield/              # intents, validators, plan-builder, prompt-fragment, types/
│   ├── chains/                 # Execution runtimes
│   │   ├── types.ts            # ChainKernel, ProtocolDriver interfaces
│   │   └── evm/                # kernel, compiler, simulator, config/, protocols/, services/
│   └── shared/                 # errors.ts, logger.ts
│
├── tests/                      # Two-tier test suite (226 tests)
│   ├── unit/                   # Deterministic, no I/O (mirrors src/)
│   ├── property/               # fast-check invariants
│   ├── fuzz/                   # Adversarial inputs
│   ├── contracts/              # External API schema guards (real calls)
│   ├── integration/            # Full pipeline (real calls)
│   ├── api/                    # Fastify app.inject (real calls)
│   ├── regression/             # Pinned bugs
│   ├── snapshots/              # Pinned IR/API shapes
│   ├── helpers/                # Registry seeding, harness, assertions
│   ├── factories/              # Object factories
│   ├── builders/               # Fluent builders
│   ├── datasets/               # Real Base constants
│   └── reporters/              # Custom .md report generator
│
├── frontend/                   # Next.js 14
│   └── src/
│       ├── app/                # App Router (page, providers, layout)
│       ├── components/         # React components
│       ├── hooks/              # useAuth, useSignTransactions
│       └── lib/                # api.ts, tokens.ts, wagmi.ts, types.ts
│
├── docker-compose.yml          # Postgres + Redis
├── vitest.config.ts            # Fast tier test config
├── vitest.integration.config.ts # Real-call tier test config
├── package.json               # Backend deps
├── vitest.config.ts           # Test config
└── .env.example               # All env vars
```

---

## Glossary

| Term | Meaning |
|------|---------|
| BPS | Basis points (1/100th of 1%). 10000 BPS = 100%. |
| LTV | Loan-to-Value ratio. debt / collateralValue. |
| LLTV | Liquidation LTV. Position gets liquidated above this. |
| WAD | 1e18. Standard fixed-point scale in DeFi. |
| Residual sweep | After strategy execution, any leftover tokens on the executor are sent back to the user. |
| Flash loan | Uncollateralized loan that must be repaid in the same transaction. Morpho offers 0% fee. |
| onBehalf | Morpho pattern where an authorized contract acts on a user's position without transferring ownership. |
| Step chaining | Strategy steps connect via balance reads — output of step N becomes input of step N+1. |
| Freshness gate | APY rates are only served if polled within maxStalenessMs. Otherwise "unavailable". |
| Curated catalog | Pre-built strategy prompts with live-refreshed APY, shown as cards in the frontend. |
