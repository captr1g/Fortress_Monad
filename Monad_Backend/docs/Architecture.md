# FORTRESS — System Architecture

## Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                         USER (Frontend / Wallet)                       │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ POST /fortress/plan
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BACKEND (Node.js / Fastify)                                          │
│                                                                       │
│  Controller → Orchestrator → Planner → Domain → Kernel → Simulator    │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Orchestrator                                                     │  │
│  │   1. Planner: assembles prompt from registry + domain fragment,  │  │
│  │      calls OpenAI (temp 0, JSON), returns IntentEnvelope         │  │
│  │   2. Domain: validates payload → typed Intent                    │  │
│  │   3. Kernel: builds calldata + simulates on Tenderly             │  │
│  │   4. Domain: computes APY preview                                │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Always-on: APY resolver (Redis+PG) · Positions poller · Strategies   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ { intent, transactions, simulation, apy }
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│  ON-CHAIN (Base Mainnet)                                              │
│  FortVault · FortStrategyExecutor · MorphoLeverageExecutor            │
│  MorphoExitExecutor · CrossChainRouter · Adapters                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Source Layout

```
src/
├── boot.ts                          Entry point
├── core/                            Shared, chain & domain agnostic
│   ├── orchestrator.ts              Planner → Domain → Kernel router
│   ├── planner/                     LLM + composable prompt assembly
│   ├── registry/                    Chain data + capability matrix
│   ├── api/
│   │   ├── controllers/             plan, simulate, exit, withdraw, positions, strategies, auth, apy
│   │   ├── routes/                  Thin wirers (URL → controller)
│   │   ├── middleware/              rate-limit
│   │   ├── serializers.ts
│   │   └── server.ts
│   └── services/                    Business logic (no HTTP)
│       ├── apy/                     Resolver, adapters (morpho/aave/staking), cache, DB, poller
│       ├── positions/               Discovery, multicall, poller
│       ├── strategies/              Curated catalog + rate refresh
│       ├── saved-strategies/
│       └── auth/                    Session, verify
├── domains/
│   └── yield/                       IntentSchema, validators, prompt rules
├── chains/
│   └── evm/
│       ├── kernel.ts                Dispatch + simulate
│       ├── contracts/               FortVault calldata builders
│       ├── protocols/               Morpho, Pendle, LiFi
│       ├── execution/               Strategy coordination, pricing, APY math
│       └── config/                  Addresses, ABIs
└── shared/                          Errors, logger
```

## Intent Routing

| Intent | Kernel dispatch | On-chain target |
|--------|----------------|-----------------|
| deposit / withdraw / rebalance | CalldataBuilder | FortVault |
| swapAndDeposit | LiFi + vault encode | FortVault.swapAndDeposit |
| bridge | LiFi + router encode | CrossChainRouter |
| strategy | StrategyService → StrategyBuilder | FortStrategyExecutor |
| leverage | LeverageService | MorphoLeverageExecutor |
| exit (button-driven) | ExitService | MorphoExitExecutor |
| refuse | throws PlannerRefusal → 422 | — |

## Execution Models

1. **Atomic multi-step.** `FortStrategyExecutor` runs ordered `Step[]`, chains each output to the next via live balance reads.
2. **Flash-loan entry.** `MorphoLeverageExecutor` flash-borrows, swaps, supplies, borrows — exact multiplier in one signature.
3. **Flash-loan unwind.** `MorphoExitExecutor` flash-borrows debt, repays, withdraws collateral, swaps, settles.

## Scaling

Adding a chain = new kernel + config + protocol drivers + `boot.ts` registration.
Adding a domain = new `domains/X/` module + `boot.ts` registration.
Adding a protocol = new driver under `chains/evm/protocols/` + capability registration.

The orchestrator, planner, API, and existing domains are never edited.

## Testing

| Tier | What | Duration | Command |
|------|------|----------|---------|
| Fast | Unit, property, fuzz, regression | ~2s | `npm test` |
| Real-call | Contracts, integration, API | ~65s | `npm run test:integration` |

Pre-push: `npm run typecheck && npm test && npm run test:integration`

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Funds | Never custodied — pulled at tx start, swept at end, atomic revert |
| Simulation | Every plan Tenderly-simulated before reaching user |
| Borrow sizing | On-chain from live oracle; maxBorrow ceiling as defense |
| APY | Freshness-gated; withheld when stale, never fabricated |
| Auth | Wallet signature (SIWE), httpOnly cookies, Redis sessions |
| Errors | Typed (`PlannerRefusal`, `InputTokenMismatch`) → deterministic HTTP codes |
| Rate limit | Per-IP sliding window |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| /fortress/plan | POST | Build transactions from a prompt |
| /fortress/simulate | POST | LLM-free re-simulation (rescale intent) |
| /fortress/exit | POST | Build exit for a Morpho position |
| /fortress/withdraw | POST | Build vault withdrawal |
| /fortress/positions | GET | Position dashboard |
| /fortress/strategies | GET | Curated catalog with live APY |
| /fortress/registry | GET | Chain/token/market data |
| /auth/* | POST/GET | Nonce, verify, me, logout |
| /apy/* | GET | Market rates |
