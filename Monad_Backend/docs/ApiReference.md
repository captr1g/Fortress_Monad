# API Reference

Base URL (local): `http://localhost:3000`. All bodies are JSON. `BigInt` values are serialized as decimal strings. CORS runs with credentials; a rate limiter allows 60 requests / 60s per client.

## Conventions

**Unsigned transaction** (returned by every build endpoint):
```json
{ "to": "0x…", "data": "0x…", "value": "0", "chainId": 8453 }
```
Transactions are ordered and state-dependent — sign and mine them sequentially.

**Simulation block:**
```json
{ "success": true, "gasUsed": "824309", "error": null }
```

**Error shape:**
```json
{ "error": { "stage": "planner|builder|exit|withdraw|positions|api", "message": "…", "details": { } } }
```
- `400` — request validation failed (Zod); `details.fields[]` lists path + message.
- `422` — planner refusal or build failure (business-logic error).
- `500` — unexpected internal error.

---

## Plan (prompt → transactions)

### `POST /fortress/plan`
The universal prompt entry point. Routes to deposit, swap-and-deposit, withdraw, rebalance, bridge, claim/cancel, strategy, or leverage.

Request:
```json
{ "prompt": "Open 2x leverage on cbETH with 1 USDC", "walletAddress": "0x…" }
```
Response:
```json
{
  "intent": { "action": "leverage", "…": "…" },
  "description": "Open 2x leverage: …",
  "transactions": [ { "to": "0x…", "data": "0x…", "value": "0", "chainId": 8453 } ],
  "simulation": { "success": true, "gasUsed": "824309", "error": null },
  "apy": { "status": "ok", "leverage": 2.01, "netApy": { "value": 0.0066, "status": "ok" }, "…": "…" },
  "depositApy": null
}
```
- `apy` — populated for `strategy` and `leverage` (net-APY preview); `null` otherwise.
- `depositApy` — populated for `deposit` and `swapAndDeposit`; `null` otherwise.
- Prompt limits: 1–2000 chars. Refusals return `422 { error.stage: "planner" }`.

See [StrategyExecution](./StrategyExecution.md), [VaultExecution](./VaultExecution.md), [LeverageExecution](./LeverageExecution.md), [PendleExecution](./PendleExecution.md), [SwapAndBridgeExecution](./SwapAndBridgeExecution.md).

---

## Exit & Positions

### `GET /fortress/position?walletAddress=0x…&market=cbETH-USDC`
Reads a single Morpho position. Returns `{ "position": PositionView }` with collateral, debt, collateralValue, ltv, lltv.

### `POST /fortress/exit`
Builds a one-signature flash-loan unwind.
```json
{ "walletAddress": "0x…", "market": "cbETH-USDC", "mode": "full_to_loan", "targetLtv": 0.3 }
```
- `mode` ∈ `full_to_loan | full_to_collateral | deleverage`. `targetLtv` required only for `deleverage`.
- Returns `{ description, transactions[], simulation, position, settlement }`. See [ExitExecution](./ExitExecution.md).

### `GET /fortress/positions?walletAddress=0x…`
Dashboard feed of live leverage positions.
```json
{ "positions": [ { "marketKey": "0x…", "collateral": "…", "debt": "…", "ltv": 0.5, "lltv": 0.86, "netApy": 0.0066, "updatedAt": "…" } ], "asOf": "…", "stale": false }
```

### `POST /fortress/positions/refresh`
Forces discovery + on-chain re-read for a wallet. `{ "walletAddress": "0x…" }` → `{ "positions": [...] }`. Called after a leverage/strategy tx confirms.

---

## Vault Withdraw (direct)

### `POST /fortress/withdraw`
Token-address-based withdraw used by the Withdraw panel.
```json
{ "walletAddress": "0x…", "tokenAddress": "0x…", "amount": "1000000", "amountType": "usdc" }
```
- `amountType` ∈ `usdc | shares | percent | all` (default `usdc`).
- Returns `{ description, protocol, shares, minUsdcOut, transactions[], simulation }`. See [VaultExecution](./VaultExecution.md).

---

## Strategies Catalog

### `GET /fortress/strategies`
Returns the curated strategy catalog with poller-computed previews:
```json
{ "strategies": [ { "id": "…", "title": "…", "prompt": "…", "status": "ok", "leverage": 1.36, "netApy": 0.0209, "collateralApy": 0.028, "borrowApy": 0.0477, "updatedAt": "…" } ], "asOf": "…" }
```

---

## APY Service

### `GET /apy/markets`
All tracked markets with latest rates:
```json
{ "markets": [ { "id": "…", "protocol": "morpho", "chainId": 8453, "name": "…", "enabled": true, "supplyApy": 0.03, "borrowApy": 0.0477, "rewardsApy": null, "updatedAt": "…" } ] }
```

### `GET /apy/:marketId`
Single market rates, or `404` if unknown.

### `GET /apy/batch?marketIds=id1,id2,…`
Batched lookup (1–50 IDs) → `{ "rates": { "<id>": { supplyApy, borrowApy, rewardsApy, updatedAt } } }`. `400` if the count is out of range.

### `GET /apy/health`
Poller liveness → `{ "status": "ok", … }`. See [ApyService](./ApyService.md).

---

## Authentication

Session/cookie-based auth routes are registered when `APY_REDIS_URL` is set (wallet sign-in). Plan/exit/withdraw endpoints accept credentialed requests (`credentials: "include"` from the frontend client). Endpoints are defined under `src/services/auth/`.
