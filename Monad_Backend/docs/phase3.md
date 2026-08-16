# Phase 3 — Architecture Refactor & Production Testing

## System Overview

Phase 2 delivered atomic strategies, flash-loan leverage/exit, Pendle integration, and always-on APY/positions services — all in a flat `src/fortress/` module with helpers, services, and utils co-located. It shipped fast, but the codebase was accumulating coupling: shared error classes were duplicated, the planner leaked EVM assumptions, and there was no automated verification that the system still worked after a change.

Phase 3 restructures the backend into a **three-plane architecture** (core → domains → chains) with a chain-neutral IR, consolidates all error classes, and delivers an industrial-grade **two-tier test suite** (226 tests) that proves production safety for a system generating real financial transactions. No new user-facing features were added — this phase is pure engineering leverage for everything that follows.

- **Chain:** Base (8453) — unchanged
- **Core principle (unchanged):** Prompt → Plan → Resolve → Build → Simulate → Sign
- **What's new:** architectural separation, unified error handling, and a test suite that catches regressions before they reach production

---

## What Changed From Phase 2

| Dimension | Phase 2 | Phase 3 |
|-----------|---------|---------|
| Source layout | Flat `src/fortress/` + `src/services/` | Three-plane: `src/core/` + `src/domains/` + `src/chains/` + `src/shared/` |
| Entry point | `src/index.ts` | `src/boot.ts` (registers chains + capabilities, wires API) |
| Intermediate Representation | Implicit (builders directly encoded calldata) | Explicit `ExecutionPlan` IR with 5 ops (approve, swap, protocolCall, flashLoan, transfer) |
| IR Compiler | — | `chains/evm/compiler.ts` — resolves symbolic refs → calldata |
| Error classes | Duplicated across `plan.service.ts` and `shared/errors.ts` | **Single source** in `@shared/errors.js`; all consumers import from there |
| Registry | Config object | `core/registry/` — capability matrix (chain × domain × protocol), typed lookups |
| Planner | Monolithic system prompt | `core/planner/prompt-assembler.ts` — composable fragments from registry + domains |
| Intent envelope | — | `core/planner/intent-envelope.ts` — `{ domain, chainKey, action, payload }` |
| Domain layer | Intents lived in `fortress/types/` | `domains/yield/` — schemas, validators, plan-builder (emit IR) |
| Tests | None (manual testing only) | **226 tests across 38 files**, two tiers (fast + real-call) |
| Build gate | `tsc` only | `npm run build` = typecheck + fast tests + compile |
| Test reports | — | Auto-generated `.md` report per run with inputs, reactions, latencies |

---

## Architecture

### Source Layout

```
src/
├── core/                          SHARED — chain & domain agnostic
│   ├── api/                       controllers, routes, middleware, serializers, server
│   ├── planner/                   LLM call, prompt-assembler, intent-envelope
│   ├── orchestrator.ts            route by domain → build → compile → simulate
│   ├── registry/                  capabilities, chains, types, lookups
│   ├── ir/                        ExecutionPlan, Operation types
│   └── services/                  apy/, positions/, strategies/, saved-strategies/, auth/
│
├── domains/                       VERTICALS — business logic, emit IR
│   └── yield/                     intents, validators, plan-builder, prompt-fragment, types/
│
├── chains/                        EXECUTION — compile IR → native, simulate
│   ├── types.ts                   ChainKernel, ProtocolDriver interfaces
│   └── evm/                       kernel, compiler, simulator, config/, protocols/, services/
│
└── shared/                        errors.ts, logger.ts
```

### Execution Plan (IR)

The chain-neutral intermediate representation that the yield domain emits and the EVM kernel compiles:

```typescript
type Operation =
  | { op: "approve";      token: Asset; spender: Ref; amount: Amount }
  | { op: "swap";         from: Asset; to: Asset; amount: Amount; minOut: Amount }
  | { op: "protocolCall"; protocol: string; method: string; args: Record<string, unknown> }
  | { op: "flashLoan";    asset: Asset; amount: Amount; inner: Operation[] }
  | { op: "transfer";     token: Asset; to: Ref; amount: Amount };
```

The compiler resolves symbolic refs (VAULT, STRATEGY_EXECUTOR, LEVERAGE_EXECUTOR, etc.) to real addresses and encodes `approve` into ERC20 calldata. `protocolCall` is a placeholder — the kernel's service layer replaces it with real protocol calldata.

### Capability Registry

```typescript
type Capability = {
  chainKey: string;      // "base"
  domain: string;        // "yield"
  protocol: string;      // "Morpho" | "Aave" | "Pendle" | "LiFi" | ...
  actions: string[];     // ["deposit", "leverage", "exit", ...]
  promptFragment?: string;
};
```

Registered at boot. The planner only sees protocols registered on the target chain. `isSupported(chain, domain, protocol)` governs routing; `getPromptFragments(chain, domain)` assembles the system prompt.

### Error Consolidation

All typed errors now live in `src/shared/errors.ts`:

| Class | HTTP mapping | Thrown by |
|-------|-------------|-----------|
| `PlannerRefusal` | 422 | Planner (out-of-domain / unsupported) |
| `InputTokenMismatch` | 400 | Plan service (binding token check) |
| `UnsupportedAmountOverride` | 400 | Simulate route (withdraw/rebalance can't rescale) |

Every consumer (controller, route, test) imports from `@shared/errors.js`. No duplicates.

---

## Testing Architecture

### Design Principles

- **Never mock internal business logic.** Math, validators, serializers, IR compiler, plan-builder all execute for real.
- **Real external calls where they prove correctness.** OpenAI, Tenderly, LiFi, Morpho, Pendle, Redis, Postgres are called live in the integration tier.
- **Gated tiers.** Default `npm test` is fast/offline (~2s). Real-call tests gated behind `RUN_INTEGRATION=1`.

### Two Tiers

| Tier | Config | Network | Duration | Command |
|------|--------|---------|----------|---------|
| Fast | `vitest.config.ts` | none | ~2s | `npm test` |
| Real-call | `vitest.integration.config.ts` | real services | ~65s | `npm run test:integration` |

### Test Categories (38 files, 226 tests)

| Category | Count | What it proves |
|----------|-------|----------------|
| Unit | 19 files | Pure math (exit-math, pricing, APY), validators, IR compiler, Zod schemas, serializers, rate limiter, amount normalization, registry lookups, suggestions |
| Property | 3 files | Invariants over thousands of generated inputs: allocations sum to 10000, borrow ceiling ≥ target, LTV monotonic, exit solvency, APY equity identity |
| Fuzz | 2 files | Adversarial inputs (injection, unicode, huge strings) never crash — only clean refusals |
| Contract | 7 files | External API schemas haven't drifted (OpenAI, Tenderly, LiFi, Morpho, Pendle, Redis, Postgres) |
| Integration | 3 files | Full pipeline: real OpenAI → real build → real Tenderly simulation |
| API | 2 files | Fastify app.inject: HTTP contract of /plan and /simulate (200/400/422) |
| Regression | 1 file | Pinned findings: float drift, IR placeholder semantics, amountFixed reset |
| Snapshot | 1 file | Pinned IR and API wire shapes |

### Test Infrastructure

```
tests/
├── unit/           Mirrors src/ structure (core/, domains/, chains/)
├── property/       fast-check invariants (1000+ runs per property)
├── fuzz/           ~6800 adversarial prompt variants + random schemas
├── contracts/      Real-call schema guards (one per external API)
├── integration/    Full pipeline (planner, deposit build, adversarial refusal)
├── api/            Fastify app.inject (plan + simulate endpoints)
├── regression/     One test per discovered bug — never regress twice
├── snapshots/      Pinned IR shapes (deposit, leverage, strategy, bridge)
├── helpers/        Registry seeding, integration gating, assertions, real-service harness
├── factories/      Intent, Position object factories
├── builders/       ExecutionPlan, EvmChainConfig fluent builders
├── datasets/       Real Base constants (tokens, markets, wallets, adversarial corpus)
└── reporters/      Custom vitest reporter → timestamped .md report per run
```

### Build Gate

`npm run build` now runs: **typecheck → fast tests → compile**. If any step fails, no output is produced.

```bash
npm run typecheck         # tsc --noEmit
npm test                  # fast tier (~2s, offline)
npm run test:integration  # real-call tier (~65s, needs .env)
npm run test:all          # both
npm run build             # typecheck + test + tsc
```

### Auto-Generated Reports

Every test run produces `tests/reports/latest.md` — a Markdown report showing:
- Executive summary (verdict, total/pass/fail, duration)
- Per-test: what was sent, how code responded, latency
- Grouped by tier (unit → property → fuzz → contract → integration → API)

---

## Key Findings Surfaced by the Test Suite

| Finding | Impact | Resolution |
|---------|--------|------------|
| `ltvToWad(0.55)` carries IEEE-754 drift of 64 wei | Economically negligible (< 1e-16 of an LTV point) | Documented and pinned in regression test |
| `InputTokenMismatch` was duplicated in two files | `suggestionsForError` silently failed for one copy | Consolidated to `@shared/errors.js` |
| `strategy-builder.ts` imported `ltvToWad` from `pricing.ts` which didn't export it | Compile error | Fixed import to `helper/utils.ts` |
| `normalizeIntentAmount` didn't clear `step.amountFixed` | Re-simulation sized off stale amount | Fixed and pinned in regression test |
| EVM compiler emits zero-address for `protocolCall` | Intentional — kernel replaces it | Documented and pinned |

---

## Migration Notes (Phase 2 → Phase 3)

For anyone working on the codebase, here's the old → new file mapping:

| Phase 2 path | Phase 3 path | Note |
|---|---|---|
| `src/index.ts` | `src/boot.ts` | Entry point |
| `src/fortress/helpers/planner.ts` | `src/chains/evm/services/planner.ts` | + `core/planner/prompt-assembler.ts` |
| `src/fortress/types/intent.ts` | `src/domains/yield/types/intent.ts` | |
| `src/fortress/services/plan.service.ts` | `src/chains/evm/services/plan.service.ts` | |
| `src/fortress/services/strategy.service.ts` | `src/chains/evm/services/strategy.service.ts` | |
| `src/fortress/helpers/strategy-builder.ts` | `src/chains/evm/services/strategy-builder.ts` | |
| `src/fortress/helpers/builder.ts` | `src/chains/evm/protocols/vault/builder.ts` | |
| `src/fortress/helpers/simulator.ts` | `src/chains/evm/simulator.ts` | |
| `src/fortress/helpers/exit-math.ts` | `src/chains/evm/protocols/morpho/exit-math.ts` | |
| `src/fortress/helpers/swap-resolver.ts` | `src/chains/evm/protocols/lifi/swap-resolver.ts` | |
| `src/fortress/helpers/apy.ts` | `src/chains/evm/services/apy.ts` | |
| `src/fortress/utils/config.ts` | `src/chains/evm/config/base.ts` | |
| `src/fortress/utils/abi.ts` | `src/chains/evm/config/base_abi.ts` | |
| `src/fortress/controllers/` | `src/core/api/controllers/` | |
| `src/fortress/routes/` | `src/core/api/routes/` | |
| `src/services/apy/` | `src/core/services/apy/` | |
| `src/services/positions/` | `src/core/services/positions/` | |
| `src/services/auth/` | `src/core/services/auth/` | |

---

## What's Next

Phase 3 establishes the structural foundation for multi-chain and multi-vertical expansion (described in [arch.md](../arch.md)):

1. **BNB (EVM)** — Same EVM kernel, new config + Venus/PancakeSwap drivers + registry entries.
2. **Solana kernel** — New `chains/solana/` with instruction compiler + RPC simulation.
3. **Prediction markets** — New `domains/prediction/` + Polymarket/Drift drivers.
4. **Strategy/leverage integration tests** — Requires a funded position; highest remaining test gap.
5. **Auth lifecycle tests** — Real Redis nonce → SIWE signature → session cookie round-trip.

Each of these is now additive — they plug into the registry and the kernel/domain interfaces without touching existing modules.

---

## Tech Stack (Delta)

Unchanged from Phase 2 (Node.js + TypeScript, Fastify, OpenAI, viem, Zod, Tenderly, Redis, Postgres, Foundry, Pendle) plus:

- **Vitest** — test runner (two configs: unit + integration)
- **fast-check** — property-based testing (thousands of generated inputs)
- **Custom MD reporter** — auto-generates institutional-grade test reports per run
