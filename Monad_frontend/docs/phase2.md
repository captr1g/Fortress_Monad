# Phase 2 — On-Chain Executor & Leveraged Strategies

## System Overview

Phase 1 delivered a tool-registry agent that built and simulated **single-protocol** actions (swap, bridge, lend, supply-borrow) and returned per-action artifacts for the wallet to sign one by one. Leverage (`morpho.multiply`) was implemented but left disabled pending atomic execution.

Phase 2 replaces that model with a purpose-built **on-chain execution layer**: a single `FortStrategyExecutor` proxy plus a set of protocol adapters that run an entire multi-step strategy **atomically in one transaction**. Two standalone flash-loan executors deliver the operations that need atomic capital — exact-multiplier leverage entry and one-signature position exit — and a Pendle adapter adds fixed-yield markets. Around this, two always-on services (APY rates and a live positions dashboard) make the experience feel like a product, not a script.

- **Chain:** Base (8453) primary; USDC bridge targets Ethereum / Arbitrum / Optimism
- **Core principle (unchanged):** Prompt → Plan → Resolve → Build → Simulate → Sign
- **What's new:** the whole strategy is now *one* atomic transaction, leverage is live, positions and yield are tracked continuously

This document is the phase-level overview. Each flow has a dedicated deep-dive:
[Strategy](./StrategyExecution.md) · [Vault](./VaultExecution.md) · [Pendle](./PendleExecution.md) · [Leverage](./LeverageExecution.md) · [Exit](./ExitExecution.md) · [Swap & Bridge](./SwapAndBridgeExecution.md) · [APY](./ApyService.md) · [Calculations](./Calculations.md) · [API](./ApiReference.md). System-level view: [Architecture](./Architecture.md).

---

## What Changed From Phase 1

| Dimension | Phase 1 | Phase 2 |
|-----------|---------|---------|
| Execution | Per-action artifacts, signed individually | One atomic `executeStrategy` (multi-step) + dedicated flash-loan executors |
| Leverage | `morpho.multiply` implemented but **disabled** | **Live** via `MorphoLeverageExecutor` (flash-loan, exact multiplier) |
| Exit / unwind | Not available | `MorphoExitExecutor` — one-signature flash-loan unwind (3 modes) |
| Borrow sizing | Off-chain amount | **On-chain** target-LTV sizing in `MorphoStrategyAdapter` |
| Fixed yield | — | Pendle PT / YT / LP + LP-wrap via `PendleStrategyAdapter` |
| Yield display | — | APY service (Morpho / Aave / staking) with freshness gating |
| Positions | — | Live dashboard service (discovery + poller + net APY) |
| Extensibility | Tool registry (off-chain) | On-chain adapter registry (`registerAdapter`) + off-chain intents |

---

## Architecture

### Pipeline Flow

```
User Prompt
  │  POST /fortress/plan { prompt, walletAddress }
  ▼
┌───────────────────────────────────────────────────────────────────┐
│ Planner (OpenAI, temp 0, JSON)                                     │
│   • System prompt: token addresses, actions, rules                 │
│   • Returns a Zod-validated Intent (discriminated union)           │
└───────────────────────────────────────────────────────────────────┘
  │
  ▼
┌───────────────────────────────────────────────────────────────────┐
│ FortressService.plan() — routes by intent.action                   │
│   deposit / swapAndDeposit / withdraw / rebalance / bridge         │
│     → CalldataBuilder / swap-resolver                              │
│   strategy   → StrategyService.resolveStrategy → StrategyBuilder   │
│   leverage   → LeverageService.buildLeverage                       │
│   (exit is its own endpoint: ExitService.buildExit)                │
└───────────────────────────────────────────────────────────────────┘
  │  RESOLVE markets · SIZE legs · fetch LiFi/Pendle calldata · ENCODE
  ▼
┌───────────────────────────────────────────────────────────────────┐
│ FortressSimulator — Tenderly bundle simulation                     │
└───────────────────────────────────────────────────────────────────┘
  │  Response: { intent, description, transactions[], simulation, apy? }
  ▼
Wallet signs ordered transactions → on-chain atomic execution
```

### On-Chain Layer

```
FortStrategyExecutor (UUPS proxy, Ownable2Step, Pausable)
├── adapters[0] SwapStrategyAdapter    — allowlisted DEX swaps, minOut, exact/full-balance
├── adapters[1] MorphoStrategyAdapter  — supply / borrow(target-LTV, on-chain-sized) / repay / withdraw
└── adapters[2] PendleStrategyAdapter  — router relay (PT/YT/LP) + LP wrap

Standalone flash-loan executors (user authorizes on Morpho):
├── MorphoLeverageExecutor  — flash → swap → supply → borrow → settle → sweep
└── MorphoExitExecutor      — flash → repay → withdraw → swap → settle → sweep
```
System diagram: [Architecture](./Architecture.md).

### Backend Layout

```
src/fortress/
  helpers/planner.ts            LLM intent extraction (Zod)
  services/plan.service.ts      Orchestrator: plan → build → simulate → APY
  services/strategy.service.ts  Market resolution, sizing, quote fetching
  services/leverage.service.ts  Flash-loan exact-multiplier entry
  services/exit.service.ts      Flash-loan unwind (3 modes)
  services/pendle.service.ts    Pendle market resolution + SDK calldata
  services/morpho.service.ts    Morpho GraphQL market lookup + position reads
  helpers/strategy-builder.ts   Two-pass Step[] encoder
  helpers/builder.ts            Vault deposit/withdraw/rebalance calldata
  helpers/swap-resolver.ts      LiFi swap/bridge quotes
  helpers/simulator.ts          Tenderly bundle simulation
  helpers/apy.ts                aggregateStrategyApy / net-APY model
src/services/apy/               Rate resolver (Morpho/Aave/staking), Redis + Postgres
src/services/positions/         Live position dashboard (discovery, poller, net APY)
```

---

## Active Capabilities (Phase 2)

| Intent / endpoint | Status | Description |
|-------------------|--------|-------------|
| `deposit` | ✅ Live | USDC into registered vault protocols (Morpho, Aave) |
| `swapAndDeposit` | ✅ Live | Any token → USDC → deposit, in one vault call |
| `withdraw` / `rebalance` | ✅ Live | Redeem / move between vault protocols |
| `bridge` | ✅ Live | Cross-chain USDC via LiFi |
| `strategy` | ✅ Live | Atomic multi-step loops (swap → supply → borrow …) |
| `leverage` | ✅ Live | Exact-multiplier flash-loan entry (replaces disabled multiply) |
| Pendle steps | ✅ Live | `swapToPt` / `swapToYt` / `addLiquidityPendle` / `wrapLp` |
| `POST /fortress/exit` | ✅ Live | Flash-loan unwind: full-to-loan / full-to-collateral / deleverage |
| APY service | ✅ Live | `GET /apy/*` + net-APY previews on plan responses |
| Positions dashboard | ✅ Live | `GET /fortress/positions` + refresh |

---

## User Flows

### Flow 1: Atomic Strategy Loop

```
User: "Loop cbETH/USDC on Morpho at 60% LTV, 3 times, starting with 100 USDC"
  → Planner: strategy intent with the fully expanded step array
  → StrategyService: resolve market, size each leg, fetch LiFi calldata sequentially,
       fetch oracle prices, read existing position, project balances
  → StrategyBuilder: two passes (quote → encode) → [approve(MAX), executeStrategy], setup: setAuthorization
  → Tenderly bundle sim → response { transactions, apy }
  → Wallet signs; executor runs SWAP → SUPPLY → (BORROW → SWAP → SUPPLY)×3 atomically
```
Detail: [StrategyExecution](./StrategyExecution.md).

### Flow 2: Exact-Multiplier Leverage

```
User: "Open 2x leverage on cbETH with 1 USDC"
  → Planner: leverage intent { inputToken=USDC, collateralToken=cbETH, inputAmount, multiplier=2 }
  → LeverageService: resolve market (LLTV headroom), flashAssets=(L-1)·E, swapIn=L·E,
       LiFi quote loan→collateral, minCollateralOut floor, pre-flight worst-case LTV check
  → txs: [approve, setAuthorization?, openLeverage]  + net-APY preview
  → Wallet signs; MorphoLeverageExecutor flash-borrows, swaps, supplies, borrows exactly the flash, settles
```
Detail: [LeverageExecution](./LeverageExecution.md).

### Flow 3: One-Signature Exit

```
User (Positions panel): "Close → USDC" on a cbETH/USDC position
  → POST /fortress/exit { market, mode: full_to_loan }
  → ExitService: read live position, computeExitAmounts, LiFi quote collateral→loan,
       minLoanOut floor, require swap covers debt
  → txs: [setAuthorization?, exitPosition]  + settlement preview
  → Wallet signs; MorphoExitExecutor flash-borrows debt, repays, withdraws, swaps, settles, sweeps surplus
```
Detail: [ExitExecution](./ExitExecution.md).

### Flow 4: Pendle Fixed-Yield Loop

```
User: "Swap 1 USDC to PT on Pendle 40acresUSDC (27 Aug 2026), supply as collateral, borrow at 80% LTV, repeat 4x"
  → resolvePendleMarkets: label → PT/market addresses, resolve Morpho PT market, rewrite steps
  → PendleMarketService: Convert API calldata (receiver = pendle adapter)
  → same strategy build/sim path; PendleStrategyAdapter relays router calldata on-chain
```
Detail: [PendleExecution](./PendleExecution.md).

### Flow 5: Deposit with APY Preview

```
User: "Deposit 1000 USDC split 60% Morpho 40% Aave"
  → CalldataBuilder.buildDeposit: split by bps, previewDeposit floors
  → computeDepositApy: blended, freshness-gated, withheld if any leg unavailable
  → txs: [approve, vault.deposit(entries)]  + depositApy
```
Detail: [VaultExecution](./VaultExecution.md).

---

## Services (New in Phase 2)

### APY Service (`src/services/apy/`)

Resolves per-market rates (Morpho API, Aave pool, DefiLlama staking), caches in Redis, persists in Postgres, and serves them through `ApyResolver` (cache → DB → live fetch) and `GET /apy/*`. Core rule: a rate is either fresh and real or withheld — never fabricated. It feeds deposit previews, strategy/leverage net APY, and live position APY. See [ApyService](./ApyService.md).

### Positions Service (`src/services/positions/`)

Discovers a wallet's Morpho positions via GraphQL, reads collateral/debt/oracle on-chain (Multicall3), computes per-position net APY, caches in Redis, persists in Postgres, and refreshes on a background poller. Read path is Redis → Postgres → discover, so the dashboard never blocks on upstream. Exposed via `GET /fortress/positions` and `POST /fortress/positions/refresh`.

### Strategies Catalog (`src/fortress/strategies/`)

A curated catalog of showcase strategies with a poller that computes their live leverage / net-APY previews, served at `GET /fortress/strategies` for the frontend's discovery panel.

---

## API Endpoints (Phase 2)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/fortress/plan` | Prompt → intent → transactions + simulation (+ apy / depositApy) |
| POST | `/fortress/exit` | Build flash-loan unwind (mode + optional targetLtv) |
| GET | `/fortress/position` | Read a single Morpho position |
| POST | `/fortress/withdraw` | Direct token-based vault withdraw |
| GET | `/fortress/positions` | Live positions dashboard feed |
| POST | `/fortress/positions/refresh` | Force position discovery + re-read |
| GET | `/fortress/strategies` | Curated strategy catalog with previews |
| GET | `/apy/markets`, `/apy/:id`, `/apy/batch`, `/apy/health` | APY rates |

Full request/response shapes and the error model: [ApiReference](./ApiReference.md).

---

## Known Limitations

| Item | Impact | Note |
|------|--------|------|
| Positions refresh latency | New position appears on the next poll (~10s), not instantly | Frontend triggers `positions/refresh` after signing; sibling panels update on their poll cadence |
| Zero-yield collateral leverage | e.g. WETH 2x shows negative net APY | Correct — a bare directional long has no collateral yield to offset borrow cost |
| Tenderly fork lag | Sim may show a revert while the fork trails live state | Real tx can still succeed; treat sim as advisory when state is fresh |
| Rate/plan state in-memory | Rate limiter is per-instance | Single-instance assumption; APY/positions state is in Redis/Postgres |
| LiFi/Pendle calldata is time-bound | Stale calldata can revert | Sign promptly after building; rebuild if the user stalls |
| Gas funding | Flash-loan txs (~0.8M gas) fail on empty wallets | Node reserves `gasLimit × maxFeePerGas + L1 fee` up front |

---

## Environment & Run

Phase 2 adds the leverage executor and Pendle adapter addresses plus the Redis/Postgres-backed services. Full env template and run instructions are in the root [README](../FortReadme.md); the APY/positions stack starts with `docker compose up -d`.

New/changed vs Phase 1:
```
FORTRESS_STRATEGY_EXECUTOR, FORTRESS_MORPHO_ADAPTER, FORTRESS_SWAP_ADAPTER,
FORTRESS_PENDLE_ADAPTER, FORTRESS_MORPHO_EXIT_EXECUTOR,
FORTRESS_MORPHO_LEVERAGE_EXECUTOR, FORTRESS_MORPHO_BLUE, FORTRESS_CHAIN_ID
APY_DATABASE_URL, APY_REDIS_URL, APY_* , POSITIONS_*
LIFI_API_KEY
```

---

## Tech Stack (Delta)

Unchanged core (Node.js + TypeScript, Fastify, OpenAI, viem, Zod, Tenderly, Vitest) plus:

- **Redis (ioredis)** — rate cache + position cache + discovery locks
- **Postgres (pg)** — APY rates and tracked-wallet positions, migrations auto-run on boot
- **Foundry** — the Solidity executor/adapter/flash-loan suite (`Contracts/`)
- **Pendle SDK API + DefiLlama** — fixed-yield routing and LST staking rates
