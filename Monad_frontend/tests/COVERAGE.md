# Fortress Test Coverage Ledger

Status of every `src/**` module against the suite. Regenerate the file list with
`find src -name '*.ts' | sort`. Run `npm test` (fast tier) and
`npm run test:integration` (real-call tier).

Legend:
- **unit** — deterministic unit test (no network)
- **prop/fuzz** — property or fuzz coverage
- **snap** — snapshot-pinned output
- **contract** — real external-API schema guard
- **integ/api** — real-call integration or `app.inject` API test
- **type-only** — types/constants/barrel; no runtime branches to test (exercised by consumers)
- **GAP** — not yet directly covered; rationale + how to close listed in §Gaps

## Counts

- Fast tier: 26 files, 199 tests, ~2s (`npm test`)
- Real-call tier: 12 files, 29 tests, ~72s (`RUN_INTEGRATION=1 npm run test:integration`)
- Source modules: 102

## Ledger

### core/
| Module | Status | Where |
|---|---|---|
| core/ir/types.ts | type-only | exercised by compiler + plan-builder tests |
| core/orchestrator.ts | GAP (target abstraction) | `PlanResult` used in serializers; class not on live route |
| core/planner/intent-envelope.ts | unit + fuzz | intent-envelope.test, schema.fuzz |
| core/planner/planner.ts | GAP (target abstraction) | live planner covered by integration/planner |
| core/planner/prompt-assembler.ts | GAP | deterministic; snapshot candidate |
| core/registry/capabilities.ts | unit | registry/capabilities.test |
| core/registry/chains.ts | unit | registry/chains.test |
| core/registry/index.ts | type-only (barrel) | registry tests import through it |
| core/registry/types.ts | type-only | — |
| core/api/serializers.ts | unit + snap | serializers.test, execution-plan.snapshot |
| core/api/server.ts | integ/api | buildRealApp; ZodError→400 & error handler hit by api tests |
| core/api/middleware/rate-limit.ts | unit | rate-limit.test (fake timers) |
| core/api/middleware/auth.ts | GAP | Redis session helpers; needs real-Redis session test |
| core/api/controllers/plan.controller.ts | api | plan.api.test (200/400/422) |
| core/api/controllers/exit.controller.ts | GAP | exit route not yet api-tested |
| core/api/controllers/withdraw.controller.ts | GAP | withdraw route not yet api-tested |
| core/api/routes/plan.route.ts | api | registerFortressRoutes via harness |
| core/api/routes/simulate.route.ts | api | simulate-and-registry.api.test |
| core/api/routes/registry.route.ts | GAP (dead on live path) | boot uses simulate.route's /registry; this is a duplicate |
| core/api/routes/{exit,withdraw,positions,strategies,saved-strategies,auth}.route.ts | GAP | see §Gaps |
| core/services/apy/math.ts | unit | apy/math.test |
| core/services/apy/types.ts | type-only | used by apy.test |
| core/services/apy/adapters/morpho.ts | contract | morpho graphql-contract (query+shape) |
| core/services/apy/adapters/aave.ts | GAP | real RPC multicall; RPC contract test candidate |
| core/services/apy/adapters/staking.ts | GAP | DefiLlama; contract candidate |
| core/services/apy/cache/redis.ts | contract (partial) | redis-contract validates the ops it uses |
| core/services/apy/db/client.ts | contract | postgres-contract (SSL connect) |
| core/services/apy/db/queries.ts | GAP | needs DB fixtures |
| core/services/apy/vault-apy.ts | integ (partial) | depositApy exercised via integration deposit |
| core/services/apy/{config,index,resolver,routes,poller/*}.ts | GAP | bootstrap/poller; need DB+Redis harness |
| core/services/auth/verify.ts | n/a (empty file) | 0 bytes; nothing to test |
| core/services/auth/{session,middleware,routes,index}.ts | GAP | needs real-Redis session lifecycle test |
| core/services/positions/*.ts | GAP | needs RPC + DB; discovery/multicall/poller |
| core/services/saved-strategies/*.ts | GAP | needs DB CRUD fixtures |
| core/services/strategies/catalog.ts | type-only (data) | PREVIEW_WALLET consumed by integration |
| core/services/strategies/*.ts | GAP | needs planner + DB |

### domains/yield/
| Module | Status | Where |
|---|---|---|
| domains/yield/intents.ts | unit + prop/fuzz | plan-builder, allocations-and-schema, validators.fuzz |
| domains/yield/plan-builder.ts | unit + prop + snap | plan-builder.test, ir-and-pricing, execution-plan.snapshot |
| domains/yield/validators.ts | unit + fuzz | validators.test, validators.fuzz |
| domains/yield/types/intent.ts | unit + prop/fuzz | intent-schema, allocations-and-schema, schema.fuzz |
| domains/yield/types/exit.ts | unit + fuzz | exit-schema, schema.fuzz |
| domains/yield/types/strategy.ts | type-only | used by strategy-validator test |
| domains/yield/types/market.ts | type-only (constants) | WAD/scale used by pricing/exit-math tests |
| domains/yield/types/lifi.ts | type-only | used by lifi contract test |
| domains/yield/index.ts | GAP (thin wrapper) | buildPlan covered via plan-builder |
| domains/yield/prompt-fragment.ts | GAP | string builder; snapshot candidate |

### chains/evm/
| Module | Status | Where |
|---|---|---|
| chains/evm/helper/utils.ts | unit + prop + fuzz | utils.test, ir-and-pricing, validators.fuzz, regression |
| chains/evm/compiler.ts | unit + prop + snap + regression | compiler.test, ir-and-pricing, snapshot, known-issues |
| chains/evm/simulator.ts | contract + integ | tenderly simulate-contract, deposit integration |
| chains/evm/services/pricing.ts | unit + prop | pricing.test, ir-and-pricing |
| chains/evm/services/apy.ts | unit | apy.test |
| chains/evm/services/strategy-validator.ts | unit | strategy-validator.test |
| chains/evm/services/suggestions.ts | unit + regression | suggestions.test, known-issues |
| chains/evm/services/plan.service.ts | unit + integ/api | amount-normalization.test + plan/simulate integration & api |
| chains/evm/services/planner.ts | integ | integration/planner (real OpenAI) |
| chains/evm/protocols/morpho/exit-math.ts | unit + prop | exit-math.test, exit-and-apy |
| chains/evm/protocols/lifi/swap-resolver.ts | contract | lifi quote-contract |
| chains/evm/protocols/pendle/pendle.service.ts | contract | pendle api-contract |
| chains/evm/protocols/vault/builder.ts | integ/api | deposit build + plan/simulate api |
| chains/evm/config/base.ts | integ | loadBaseConfig via harness |
| chains/evm/config/base_abi.ts | unit (partial) | erc20Abi via compiler + tenderly contract |
| chains/evm/types.ts, chains/types.ts | type-only | — |
| chains/evm/kernel.ts | GAP (target abstraction) | not on live route |
| chains/evm/services/strategy.service.ts | GAP | strategy integration candidate (real Morpho+LiFi) |
| chains/evm/services/strategy-builder.ts | GAP | strategy integration candidate |
| chains/evm/protocols/morpho/leverage.service.ts | GAP | leverage integration candidate |
| chains/evm/protocols/morpho/exit.service.ts | GAP | exit integration candidate (needs live position) |
| chains/evm/protocols/morpho/morpho.service.ts | contract (partial) | GraphQL shape validated; resolver path is a GAP |
| chains/evm/protocols/pendle/pendle-vault.service.ts | GAP | Pendle deposit encoding integration candidate |
| chains/evm/protocols/vault/withdraw.service.ts | GAP | withdraw endpoint integration candidate |

### shared/ & entry
| Module | Status | Where |
|---|---|---|
| shared/errors.ts | unit + regression | errors.test, known-issues |
| shared/logger.ts | type-only (logging) | exercised by harness/services |
| boot.ts | GAP (bootstrap) | wiring replicated by harness; full-boot e2e candidate |

## Gaps — prioritized next expansion

These are documented, not forgotten. Each needs a real-service fixture (DB rows,
a live leveraged position, or a funded wallet) and belongs in the real-call tier.

1. **Strategy & leverage pipelines** (strategy.service, strategy-builder, leverage.service):
   real supply+borrow / loop / 2x-leverage builds through Tenderly. Highest business value.
2. **Exit & withdraw endpoints** (exit.service, withdraw.service + their controllers/routes):
   need a live leveraged position for the wallet under test; assert settlement math.
3. **Positions service** (discovery, multicall, service, poller): real Morpho GraphQL +
   multicall reads for a known wallet; assert position/LTV shape.
4. **Auth lifecycle** (session, verify-in-route, middleware): real Redis nonce→SIWE
   signature (viem)→session cookie→/auth/me round-trip.
5. **APY resolver + poller + queries**: real Postgres + Redis; freshness-gating behavior.
6. **Saved strategies + strategies catalog**: DB CRUD, max-3 limit, seed/refresh.
7. **Prompt assembly** (prompt-assembler, prompt-fragment, yield/index): snapshot the
   assembled system prompt so planner-prompt drift is visible in review.
8. **Dead/duplicate code flagged**: `core/api/routes/registry.route.ts` is not wired
   (boot uses the simulate.route version); `core/services/auth/verify.ts` is an empty
   file though `developer.md` documents it. Both worth resolving in source.

## How to run

```bash
npm test                 # fast, deterministic, offline (unit/property/fuzz/regression/snapshot)
npm run test:integration # real OpenAI/Tenderly/RPC/LiFi/Morpho/Pendle/Redis/Postgres
npm run test:all         # both tiers
```
