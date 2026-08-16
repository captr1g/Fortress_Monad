# Recent Backend Changes (Saved Strategies, Amount/Registry, Suggestions)

For a teammate picking this up — three independent features landed on `prompt_2_defi` recently. None of them touch `/fortress/plan`'s existing contract in a breaking way (all new fields are additive/optional), but two add new routes and one adds a new table. See [ApiReference](./ApiReference.md) for the full endpoint list; this doc explains *why* and *what changed*.

---

## 1. Saved Strategies (new feature, new table)

Users can now save a generated plan, list/rename/delete their saved ones, and get a "last used" timestamp — backed by Postgres instead of client-side localStorage/AsyncStorage.

**Table** `saved_strategies` (migrations `006_saved_strategies.sql`, `007_saved_strategies_activity.sql`):
```sql
id TEXT PRIMARY KEY, wallet TEXT NOT NULL, name TEXT NOT NULL,
prompt TEXT NOT NULL, preview JSONB NOT NULL,
saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
renamed_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ  -- added in 007
```
Indexed on `wallet`. `ensureSchema()` in `src/fortress/saved-strategies/index.ts` applies both migrations idempotently on boot (`ADD COLUMN IF NOT EXISTS`), so there's nothing to run manually against Cloud Run/Supabase.

**Code**: `src/fortress/saved-strategies/`
- `db.ts` — raw `pg` queries, every read/write scoped `WHERE id = $1 AND wallet = $2` (no cross-wallet access).
- `saved-strategies.service.ts` — `MAX_SAVED_STRATEGIES = 3` per wallet; throws `LimitReachedError` past that, `NotFoundError` on a missing/foreign id.
- `saved-strategies.controller.ts`, `routes/saved-strategies.route.ts`.

**Endpoints** (all under `/fortress/saved-strategies`):
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/` | `?walletAddress=0x…` | list, newest first |
| POST | `/` | `{ walletAddress, name, prompt, preview }` | 409-ish `LimitReachedError` at 3 saved |
| DELETE | `/:id` | `{ walletAddress }` | |
| PATCH | `/:id` | `{ walletAddress, name }` | sets `renamed_at` |
| POST | `/:id/use` | `{ walletAddress }` | sets `last_used_at` — call this when a saved strategy is opened/re-run, drives the "Activity" timeline on the frontend |

No LLM or Tenderly call anywhere in this feature — it's pure CRUD against a JSON blob (the original `Preview`).

---

## 2. Decoupled amount + binding starting token + LLM-free re-simulate

**Problem this fixes**: the deposit/strategy amount used to live inside the prompt text (e.g. "invest **5 USDC**..."), so changing the amount meant re-running the LLM. Same for the starting token — it was prose the planner could ignore. Now amount is a real parameter and starting token is a validated constraint.

### 2a. `POST /fortress/simulate` — re-run at a new amount, no LLM call

`plan.service.ts` split the old inline resolve→build→simulate block into a public method:

```ts
async planFromIntent(intent: Intent, walletAddress: `0x${string}`, log): Promise<PlanResult>
```

`plan()` (the existing `/fortress/plan` path) now just does `extractIntent()` then delegates to `planFromIntent()`. The new route reuses the same method directly, skipping the LLM entirely:

```
POST /fortress/simulate
{ walletAddress: "0x…", intent: <the intent object from a prior /fortress/plan response>, amount?: "5000000" }
→ same response shape as /fortress/plan (see serializePlanResult below)
```

If `amount` is present, `normalizeIntentAmount(intent, amount)` rescales it before rebuilding:
- `strategy` → sets `inputAmount`, **and strips `amountFixed` off every step**. This matters: `resolveStrategy` (in `strategy.service.ts`) pins each step's `amountFixed` to the original amount during resolution. Re-simulating at a different amount without stripping those would silently ignore the new amount for anything downstream of the first step. Dropping them lets the bps-proportional step sizing recompute correctly.
- `leverage` → sets `inputAmount`.
- `deposit` / `swapAndDeposit` / `bridge` → sets `amount`.
- anything else (e.g. `withdraw`) → throws `UnsupportedAmountOverride` → `400`.

One Tenderly call per hit, zero OpenAI calls — cheap to call on every keystroke-settle in the UI.

`plan.controller.ts` also gained `serializePlanResult(result)`, extracted so `/fortress/plan` and `/fortress/simulate` can't drift in response shape — both routes call the same function.

### 2b. Binding starting token

`PlanRequestSchema` (in `plan.controller.ts`) gained an optional field:
```ts
inputToken?: `0x${string}`  // address, validated against the chain registry (see §3)
```
When present:
1. Controller resolves it via `findToken(chainId, address)` — 400 if it's not a registered token.
2. `FortressPlanner.extractIntent(prompt, { inputToken })` appends an "INPUT TOKEN CONSTRAINT" block to the LLM messages naming the token, so the planner is told (not just hinted) what the user actually holds.
3. After extraction, `plan.service.ts` checks the intent's actual input token (`intentInputToken(intent)` — reads `intent.inputToken` for `strategy`/`leverage`/`swapAndDeposit`) against the requested address. Mismatch → throws `InputTokenMismatch`, which the controller turns into a `422` with a recovery suggestion (§4).

This is enforcement, not just a prompt hint — if the LLM ignores the constraint, the request fails loudly instead of silently building a plan starting from the wrong token.

---

## 3. Chain/token registry (`src/fortress/config/registry.ts`)

Previously chain/token data (addresses, decimals, supported markets) was duplicated across the planner's system-prompt prose and `utils/tokens.ts`, with more copies on the frontend. Now there's one file:

```ts
export const CHAIN_REGISTRY: Record<number, ChainInfo>
// ChainInfo = { chainId, label, executable, loanToken, tokens: TokenInfo[], markets: MarketInfo[] }
// TokenInfo = { symbol, name, address, decimals, stable?, inputEnabled? }
// MarketInfo = { label /* "cbETH-USDC" */, collateral, loan }
```
Base (8453) is fully seeded (12 tokens, 5 Morpho markets, `executable: true`). Ethereum/Arbitrum/Optimism are stub entries (`executable: false`) — present so the registry endpoint can list "coming soon" chains without new code, not because those chains can execute anything yet.

Consumers:
- `utils/tokens.ts` is now a thin wrapper (`tokenAddress()` delegates to `findToken`) — no behavior change, just de-duplication.
- `helpers/planner.ts`'s system prompt is generated from the registry (token table, decimals in the amount-parsing examples, supported market labels) instead of hand-written prose. **Adding a token or market is now a data change in `registry.ts` — it no longer requires editing the planner prompt.**
- `helpers/suggestions.ts` (§4) generates token/market chips from it.
- New endpoint:
  ```
  GET /fortress/registry
  → { chains: [{ chainId, label, executable, loanToken, tokens, markets }] }
  ```
  Static JSON, no auth, no wallet param — this is what both frontends should treat as the source of truth for token pickers, instead of hardcoding lists client-side.

---

## 4. Error suggestions (`src/fortress/helpers/suggestions.ts`)

Failed generations used to return just `{ error: { stage, message } }` with nothing actionable. Both `/fortress/plan` and `/fortress/simulate` now attach a `suggestions` array to the error object:

```ts
type Suggestion = { label: string; insertText?: string };
```
`label` is always shown as text. `insertText` present means the frontend should render it as a tappable chip that appends that line to the user's prompt and lets them regenerate — `insertText` absent means it's a plain hint with nothing to insert.

`suggestionsForError(err, chainId)` pattern-matches on the error:
- `InputTokenMismatch` → one chip: "Start from {symbol}".
- `PlannerRefusal` mentioning an unknown/invalid token → the supported-token list as text + one chip per `inputEnabled` registry token.
- `PlannerRefusal` mentioning a missing amount → one chip inserting a concrete "I have 1 {loanToken} on {chain}." line.
- Builder/resolver error mentioning an unrecognized market → the supported-market list as text + up to 3 market chips.
- Anything else → `[]` (frontend falls back to the plain error message, unchanged from before).

This reads from the same registry as §3, so suggestion text stays correct as tokens/markets are added.

---

## Error shape recap

`/fortress/plan` and `/fortress/simulate` error responses now look like:
```json
{ "error": { "stage": "planner|builder", "message": "…", "suggestions": [{ "label": "…", "insertText": "…" }] } }
```
`suggestions` is new but always present (possibly `[]`) — existing error-handling code that only reads `stage`/`message` doesn't need to change.

## What's unaffected

`/fortress/plan`'s request/response shape is unchanged except for the new optional `inputToken` request field and the new `suggestions` array in errors — a caller that never sends `inputToken` sees identical behavior to before. Exit/withdraw/position routes, the strategy/leverage resolvers, and the simulator are untouched.
