# Fortress Test Architecture

Goal: prove the backend is production-safe for a system that generates real financial
transactions. Not coverage theater. Every test either proves an invariant, guards a
contract with an external system, or pins a behavior against regression.

## The two tiers

Fortress talks to OpenAI, Tenderly, Alchemy RPC, Morpho, Pendle, LiFi, Postgres and Redis.
The requirement is: **never mock internal business logic, and make external calls real
wherever a real call is what actually proves the behavior.** But a suite that hits paid,
rate-limited, non-deterministic services on every save is unusable. So the suite is tiered:

| Tier | Config | Env | Network | Runs on | Command |
|------|--------|-----|---------|---------|---------|
| **Unit / property / fuzz / regression / snapshot** | `vitest.config.ts` | deterministic fake env | none | every commit | `npm test` |
| **Integration / contract / api / e2e** | `vitest.integration.config.ts` | real `.env` | real services | on demand / CI | `npm run test:integration` |

The split is not "unit = mocked". The unit tier runs **pure business logic with zero
mocking** — the code under test genuinely executes; it just happens to need no I/O (math,
validators, serializers, the IR compiler, registries, Zod schemas). The integration tier is
where "every call must be real" lives: the real planner, real Tenderly simulation, real
protocol quotes, real DB/Redis. Nothing between the prompt and the calldata is faked.

The only sanctioned stub is the OpenAI planner inside a handful of API tests, where we pin a
known intent to exercise the HTTP/serialization/error paths deterministically — the planner
itself is proven for real in `integration/planner` and `contracts/openai`.

## Folder map (mirrors the production architecture)

```
tests/
├── unit/                 Deterministic, no network. Layout mirrors src/.
│   ├── core/             registry, ir compiler, serializers, planner envelope, api middleware
│   ├── domains/          yield intent schemas, validators, plan-builder
│   ├── chains/           evm compiler, helpers, exit-math, pricing math
│   ├── protocols/        per-protocol pure logic
│   └── shared/           error classes, logger
├── integration/          Real calls. Full pipeline, grouped by feature.
│   ├── planner/          prompt -> real LLM -> Zod-valid intent
│   ├── plan/             intent -> build -> real Tenderly sim -> response
│   ├── leverage/  strategy/  withdraw/  exit/  bridge/  positions/  auth/
├── e2e/                  Booted server, real request lifecycle end to end.
├── contracts/            External API schema guards — fail fast on contract drift.
│   ├── openai/ tenderly/ lifi/ morpho/ pendle/ redis/ postgres/
├── api/                  Fastify app.inject endpoint tests (success + every failure path).
├── property/             fast-check invariants (business logic executes for real).
├── fuzz/                 Adversarial/malformed prompts & payloads; must never crash.
├── regression/           One test per fixed bug. Never regress twice.
├── snapshots/            Pinned planner outputs, plans, and API responses.
├── fixtures/             Static known-good inputs/outputs (JSON, prompts).
├── factories/            Programmatic object builders (Intent, IntentEnvelope, Position...).
├── builders/             Fluent builders (ExecutionPlan, EvmChainConfig...).
├── mocks/                Thin external-service doubles (OpenAI only, by exception).
├── helpers/              Shared setup: registry seeding, integration gating, assertions.
└── datasets/             Real on-chain constants: Base tokens, markets, wallets, addresses.
```

### Why each folder exists

- **unit** — the bulk of confidence per second. Pure functions and schemas where a bug is a
  math/logic error, not an integration error. Mirrors `src/` so the test for any module is
  found by path.
- **integration** — proves the modules compose correctly against the real world: the LLM
  really returns a parseable intent, the builder's calldata really simulates, LiFi really
  quotes a route. This is where financial correctness is actually established.
- **e2e** — proves the wired server (boot → routes → services) serves a real request.
- **contracts** — external APIs change without warning. These parse real responses against
  the shapes our code assumes, so a Morpho/LiFi/Pendle/OpenAI schema change breaks a test
  instead of production.
- **api** — every endpoint's HTTP contract: status codes, validation, serialization, auth,
  refusals. Uses `app.inject` (no socket) so it is fast and hermetic.
- **property** — invariants that must hold for *all* inputs (allocations sum to 10000, no
  empty calldata, LTV in range), checked over thousands of generated cases.
- **fuzz** — the planner and validators face hostile input (injection, unicode, huge
  strings). These assert graceful refusal, never a crash or a malformed transaction.
- **regression** — every bug found gets a permanent test here.
- **snapshots** — pin serialized outputs so unintended shape changes are visible in review.
- **fixtures / factories / builders / datasets / mocks / helpers** — DRY test-data
  infrastructure so tests stay readable, independent, and deterministic (AAA, factory,
  builder patterns).

## Conventions

- Arrange / Act / Assert, one behavior per test, descriptive names, no shared mutable state.
- Real values (token addresses, wallets) come from `datasets/`, never inline magic strings.
- Integration/contract tests are gated: they `skip` unless `RUN_INTEGRATION=1` so the fast
  tier never depends on network or credentials.
