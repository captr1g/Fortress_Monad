# FORTRESS — Backend Architecture

## Request Lifecycle

```
POST /fortress/plan { prompt, walletAddress, inputToken? }
  │
  ├─ plan.controller.ts ─── validates body, resolves inputToken
  │
  ├─ Orchestrator.plan(prompt, chainKey, wallet)
  │     │
  │     ├─ Planner.extractIntent(prompt, assemblyCtx)
  │     │     ├─ prompt-assembler.ts builds system prompt:
  │     │     │     • core header
  │     │     │     • chain data (tokens, markets from registry)
  │     │     │     • yield domain fragment (full strategy/pendle/leverage rules)
  │     │     │     • response format (IntentEnvelope shape)
  │     │     ├─ OpenAI (temp 0, JSON mode)
  │     │     └─ returns IntentEnvelope { domain, chainKey, action, payload }
  │     │
  │     ├─ YieldDomain.parsePayload(envelope) → typed Intent
  │     │
  │     ├─ EvmKernel.execute(intent, wallet)
  │     │     ├─ resolveZeroAmount (reads balance if amount="0")
  │     │     ├─ buildTransactions (dispatches by intent.action):
  │     │     │     deposit/withdraw/rebalance → CalldataBuilder
  │     │     │     strategy → StrategyService
  │     │     │     leverage → LeverageService
  │     │     │     swapAndDeposit → LiFi + vault encode
  │     │     │     bridge → LiFi + router encode
  │     │     └─ simulate (Tenderly)
  │     │
  │     └─ YieldDomain.computeDepositApy()
  │
  └─ reply: { intent, transactions, simulation, apy, depositApy }
```

## Source Layout

```
src/
├── boot.ts                          Entry point. Wires everything.
│
├── core/                            SHARED — chain & domain agnostic
│   ├── orchestrator.ts              Routes: planner → domain → kernel
│   ├── planner/
│   │   ├── planner.ts              LLM call → IntentEnvelope
│   │   ├── prompt-assembler.ts     Composable system prompt from registry + domains
│   │   └── intent-envelope.ts      { domain, chainKey, action, payload } schema
│   ├── registry/
│   │   ├── chains.ts               Chain data (tokens, markets, vm)
│   │   ├── capabilities.ts         (chain × domain × protocol) matrix
│   │   ├── types.ts                ChainInfo, Capability, TokenInfo
│   │   └── index.ts                Lookups (getChain, findToken, isSupported)
│   ├── api/
│   │   ├── controllers/            HTTP handlers (validate → call service → respond)
│   │   ├── routes/                 Thin wirers (URL → controller method)
│   │   ├── middleware/             rate-limit
│   │   ├── serializers.ts          BigInt → string, PlanResult → JSON
│   │   └── server.ts              Fastify factory
│   └── services/                   Business logic + data (no HTTP)
│       ├── apy/                    Rate resolver, adapters, cache, DB, poller
│       ├── positions/              Discovery, multicall, poller, net APY
│       ├── strategies/             Curated catalog, live APY refresh
│       ├── saved-strategies/       User-saved strategies
│       └── auth/                   Session, verify, middleware
│
├── domains/                         VERTICALS — business rules, emit intents
│   └── yield/
│       ├── index.ts                YieldDomain (promptFragment, parsePayload, computeDepositApy)
│       ├── validators.ts           validateStrategySteps
│       ├── prompt-fragment.ts      Full LLM rules for yield actions
│       └── types/
│           ├── intent.ts           IntentSchema (discriminated union on action)
│           ├── strategy.ts         StrategyStepSchema, StrategyBuildContext
│           ├── exit.ts             ExitMode, ExitRequest, PositionView
│           ├── market.ts           WAD, ORACLE_PRICE_SCALE, MorphoMarketParams
│           └── lifi.ts             SwapData shape
│
├── chains/                          EXECUTION — build calldata, simulate
│   ├── types.ts                    Vm type ("evm" | "svm" | "move")
│   └── evm/
│       ├── kernel.ts               EvmKernel (dispatch intent → builders → simulate)
│       ├── simulator.ts            Tenderly bundle simulation
│       ├── types.ts                EvmTransaction, EvmChainConfig, BuildResult
│       ├── contracts/              YOUR deployed contracts
│       │   ├── vault-builder.ts    CalldataBuilder (deposit/withdraw/rebalance)
│       │   └── vault-withdraw.ts   WithdrawService
│       ├── protocols/              EXTERNAL third-party protocols
│       │   ├── morpho/             morpho.service, leverage.service, exit.service, exit-math
│       │   ├── pendle/             pendle.service, pendle-vault.service
│       │   └── lifi/               swap-resolver
│       ├── execution/              Multi-protocol coordination
│       │   ├── strategy.service.ts  Coordinates morpho + lifi + pendle for strategies
│       │   ├── strategy-builder.ts  Encodes executeStrategy calldata
│       │   ├── strategy-validator.ts  Validates step sequences
│       │   ├── pricing.ts          Oracle reads, computeBorrowCeiling
│       │   ├── apy.ts              computeNetApy, aggregateStrategyApy
│       │   ├── suggestions.ts      Error → recovery chips
│       │   └── intent-utils.ts     normalizeIntentAmount, intentInputToken
│       ├── config/
│       │   ├── base.ts             loadBaseConfig()
│       │   └── base_abi.ts         ABI fragments
│       └── helper/
│           └── utils.ts            ltvToWad, norm
│
└── shared/
    ├── errors.ts                   PlannerRefusal, InputTokenMismatch, UnsupportedAmountOverride
    └── logger.ts                   FortressLogger (structured, per-request)
```

## Scaling Rules

| Adding... | What you create | What you edit |
|-----------|-----------------|---------------|
| New EVM chain (BNB) | `chains/evm/config/bnb.ts` + protocol drivers | `boot.ts` only |
| New VM (Solana) | `chains/solana/` (kernel + protocols) | `boot.ts` + `chains/types.ts` |
| New domain (prediction) | `domains/prediction/` (index + prompt-fragment + types) | `boot.ts` only |
| New protocol on existing chain | protocol driver under `chains/evm/protocols/` | `boot.ts` (registerCapabilities) |

The orchestrator, planner, API routes, controllers, and existing domains are never edited for new chains/domains/protocols.

## Testing

```bash
npm run typecheck         # tsc --noEmit (0 errors)
npm test                  # Fast tier: unit/property/fuzz/regression (~2s)
npm run test:integration  # Real-call tier: OpenAI/Tenderly/LiFi/Morpho/Pendle/Redis/PG (~65s)
npm run build             # typecheck + test + compile
```

## Key Design Decisions

1. No IR layer. Builds are sequential and network-dependent (LiFi quotes, oracle reads mid-build). The kernel dispatches directly to protocol-specific builders.
2. Planner returns IntentEnvelope `{ domain, chainKey, action, payload }`. The domain validates payload against its schema.
3. All error classes in `@shared/errors.js`. Single source. HTTP mapping: PlannerRefusal→422, validation→400.
4. `protocols/` = external DeFi protocols. `contracts/` = your deployed contracts. `execution/` = multi-protocol coordination.
5. `services/` = business logic + data (never imports Fastify). `controllers/` = HTTP handlers. `routes/` = thin wirers.
