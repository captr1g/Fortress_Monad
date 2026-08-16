# Phase 4 — Live Architecture Wiring

## Overview

Phase 3 introduced the three-plane structure (core/domains/chains) and a test suite, but the live request path still ran through the old monolithic `FortressService` + `FortressPlanner`. The new architecture was partially dead code.

Phase 4 makes it real. Every request now flows through the production architecture: Orchestrator → composable Planner → YieldDomain → EvmKernel. No dead code remains. The codebase is honest about what it does and ready to scale.

## What Changed

| Before (Phase 3) | After (Phase 4) |
|-------------------|-----------------|
| `FortressPlanner` in `chains/evm/services/planner.ts` (monolithic prompt) | `core/planner/planner.ts` + `prompt-assembler.ts` + `yield/prompt-fragment.ts` |
| `FortressService` in `chains/evm/services/plan.service.ts` (god class) | Orchestrator + EvmKernel (separated coordination from execution) |
| Flat `Intent` returned by planner | `IntentEnvelope { domain, chainKey, action, payload }` |
| Dead `core/orchestrator.ts` | Live orchestrator routing every request |
| Dead `core/ir/types.ts` + `compiler.ts` + `plan-builder.ts` | Deleted. Builds are direct (sequential, network-dependent). |
| `services/` folder mixing protocols + coordination | `protocols/` (external) + `contracts/` (internal) + `execution/` (coordination) |
| Controllers scattered in `services/` | All controllers in `core/api/controllers/` |
| Routes with inline handler logic | Routes are thin wirers; logic lives in controllers |
| Duplicate `intents.ts` and `types/intent.ts` | Single `types/intent.ts` with exported `StrategyStepSchema` from `types/strategy.ts` |
| Duplicate error classes across files | Single source in `@shared/errors.js` |

## Files Deleted

| File | Reason |
|------|--------|
| `chains/evm/services/planner.ts` | Replaced by `core/planner/planner.ts` + `domains/yield/prompt-fragment.ts` |
| `chains/evm/services/plan.service.ts` (class) | Split into Orchestrator (coordination) + EvmKernel (execution). Utility functions kept as `execution/intent-utils.ts` |
| `core/ir/types.ts` | IR not used — builds are direct |
| `chains/evm/compiler.ts` | Same reason |
| `domains/yield/plan-builder.ts` | Same reason |
| `domains/yield/intents.ts` | Duplicate of `types/intent.ts` |
| `core/api/routes/registry.route.ts` | Dead (registry endpoint lives in simulate controller) |
| `core/services/auth/routes.ts` | Moved to `core/api/routes/auth.route.ts` |
| `core/services/auth/controller.ts` | Moved to `core/api/controllers/auth.controller.ts` |
| `core/services/strategies/strategies.controller.ts` | Moved to `core/api/controllers/` |
| `core/services/saved-strategies/saved-strategies.controller.ts` | Moved to `core/api/controllers/` |
| `core/services/apy/routes.ts` | Split into `core/api/routes/apy.route.ts` + `controllers/apy.controller.ts` |

## Files Renamed

| Old path | New path |
|----------|----------|
| `chains/evm/services/strategy.service.ts` | `chains/evm/execution/strategy.service.ts` |
| `chains/evm/services/strategy-builder.ts` | `chains/evm/execution/strategy-builder.ts` |
| `chains/evm/services/strategy-validator.ts` | `chains/evm/execution/strategy-validator.ts` |
| `chains/evm/services/pricing.ts` | `chains/evm/execution/pricing.ts` |
| `chains/evm/services/apy.ts` | `chains/evm/execution/apy.ts` |
| `chains/evm/services/suggestions.ts` | `chains/evm/execution/suggestions.ts` |
| `chains/evm/services/plan.service.ts` | `chains/evm/execution/intent-utils.ts` (utilities only) |
| `chains/evm/protocols/vault/builder.ts` | `chains/evm/contracts/vault-builder.ts` |
| `chains/evm/protocols/vault/withdraw.service.ts` | `chains/evm/contracts/vault-withdraw.ts` |

## Live Request Flow

```
POST /fortress/plan
  → plan.controller.ts (validates, resolves inputToken)
  → Orchestrator.plan(prompt, "base", wallet)
    → Planner.extractIntent(prompt, assemblyCtx)
      → prompt-assembler builds system prompt from registry + yield fragment
      → OpenAI (temp 0, JSON mode) → IntentEnvelope
    → YieldDomain.parsePayload(envelope) → typed Intent
    → EvmKernel.execute(intent, wallet)
      → resolveZeroAmount
      → buildTransactions (dispatch by action)
      → Tenderly simulate
    → YieldDomain.computeDepositApy()
  → serializePlanResult → HTTP 200
```

## Design Decisions

1. **No IR.** Strategy builds fetch live LiFi quotes sequentially, read oracles mid-build, project state step-by-step. An IR that pretends this is a pure data transform doesn't match reality. The kernel dispatches directly to specialized builders.

2. **IntentEnvelope.** The planner outputs `{ domain, chainKey, action, payload }`. The orchestrator routes by `domain` and `chainKey`. The domain validates `payload` against its schema. When prediction markets arrive, the planner auto-includes their prompt fragment and outputs `domain: "prediction"`.

3. **`protocols/` vs `contracts/` vs `execution/`.** External DeFi protocols (Morpho, Pendle, LiFi) are in `protocols/`. Your own deployed contracts (FortVault, executors) are in `contracts/`. Multi-protocol coordination logic (strategy service, pricing, APY math) is in `execution/`.

4. **Services never import Fastify.** All HTTP handling lives in `core/api/controllers/`. Services are pure business logic and data access. Routes are 4-line wirers.

## Scaling Proof

Adding BNB: `chains/evm/config/bnb.ts` + `registerChain(...)` + `registerCapabilities(...)` + new EvmKernel in `boot.ts`. Zero changes to orchestrator, planner, domain, controllers, or routes.

Adding prediction markets: `domains/prediction/` with `index.ts` + `prompt-fragment.ts` + `types/intent.ts`. Register in `boot.ts`. The planner auto-includes the prediction fragment. The orchestrator routes `domain: "prediction"`.

## Verification

```bash
npm run typecheck         # 0 errors
npm test                  # 23 files, 170 tests, all green
npm run test:integration  # 25/29 pass (4 require OpenAI quota)
```
