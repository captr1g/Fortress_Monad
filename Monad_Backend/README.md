# FORTRESS — Prompt to DeFi

Describe a DeFi strategy in plain language; FORTRESS plans it, sizes every leg, simulates it, and returns signable transactions. One prompt, one preview, one signature — atomic execution on Base.

```
User Prompt → Planner (LLM) → IntentEnvelope → Domain (validate) → Kernel (build + simulate) → Signable Transactions
```

## What It Can Do

| Capability | Prompt example |
|-----------|----------------|
| Deposit / lend | "Deposit 500 USDC split 60% Morpho 40% Aave" |
| Swap-and-deposit | "Deposit 1 WETH to Morpho" |
| Withdraw / rebalance | "Withdraw 50% from Morpho" · "Move my Aave position to Morpho" |
| Bridge | "Bridge 1000 USDC to Arbitrum" |
| Strategy loops | "Loop cbETH/USDC on Morpho at 60% LTV, 3 times" |
| Exact leverage | "Open 2x leverage on cbETH with 100 USDC" |
| Pendle | "Deposit 1 USDC into Pendle fixed yield" |
| Exit | Positions panel → Close / Deleverage |

## Architecture

```
src/
├── boot.ts                     Entry point — wires everything
├── core/                       SHARED (chain & domain agnostic)
│   ├── orchestrator.ts         Planner → Domain → Kernel router
│   ├── planner/                LLM call + composable prompt assembly
│   ├── registry/               Chain + capability matrix
│   ├── api/
│   │   ├── controllers/        HTTP handlers
│   │   ├── routes/             Thin URL → controller wirers
│   │   └── middleware/         Rate limiting
│   └── services/               Business logic (apy, positions, strategies, auth)
├── domains/                    VERTICALS
│   └── yield/                  Intent schema, validators, LLM prompt rules
├── chains/                     EXECUTION
│   └── evm/
│       ├── kernel.ts           Dispatch intent → builders → Tenderly simulate
│       ├── contracts/          YOUR contracts (FortVault calldata)
│       ├── protocols/          External protocols (Morpho, Pendle, LiFi)
│       ├── execution/          Multi-protocol coordination (strategy, pricing, APY)
│       └── config/             Addresses, ABIs
└── shared/                     Errors, logger
```

See [`arch.md`](./arch.md) for the full request lifecycle and scaling rules.

## Run

```bash
npm install
cp .env.example .env              # fill in keys
docker compose up -d              # Redis + Postgres
npm run dev                       # Backend on :3000

cd frontend && npm install && npm run dev   # Frontend on :3001
```

## Test

```bash
npm run typecheck                 # tsc --noEmit
npm test                          # Fast tier (~2s): unit, property, fuzz, regression
npm run test:integration          # Real-call tier (~65s): OpenAI, Tenderly, LiFi, Morpho, Pendle, Redis, PG
npm run build                     # typecheck + test + compile (pre-push gate)
```

## Environment

```env
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
TENDERLY_ACCESS_KEY=
TENDERLY_ACCOUNT_SLUG=
TENDERLY_PROJECT_SLUG=
RPC_BASE=
LIFI_API_KEY=
FORTRESS_VAULT=
FORTRESS_STRATEGY_EXECUTOR=
FORTRESS_MORPHO_ADAPTER=
FORTRESS_SWAP_ADAPTER=
FORTRESS_PENDLE_ADAPTER=
FORTRESS_MORPHO_BLUE=
FORTRESS_MORPHO_EXIT_EXECUTOR=
FORTRESS_MORPHO_LEVERAGE_EXECUTOR=
FORTRESS_CROSS_CHAIN_ROUTER=
FORTRESS_USDC=
FORTRESS_LIFI_DIAMOND=
FORTRESS_PENDLE_ROUTER=
FORTRESS_CHAIN_ID=8453
APY_DATABASE_URL=postgresql://apy:apy_secret@localhost:5432/apy_service
APY_REDIS_URL=redis://localhost:6379
APY_POLL_INTERVAL_MS=60000
APY_MAX_STALENESS_MS=300000
POSITIONS_POLL_INTERVAL_MS=30000
PORT=3000
```

## Documentation

- [`arch.md`](./arch.md) — source layout, request lifecycle, scaling rules
- [`docs/Architecture.md`](./docs/Architecture.md) — system architecture deep dive
- [`docs/phase4.md`](./docs/phase4.md) — this refactor (Phase 4)
- [`docs/`](./docs) — per-feature execution docs (strategy, leverage, exit, pendle, APY, API reference)
