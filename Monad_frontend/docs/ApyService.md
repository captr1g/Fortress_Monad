# APY Service Execution

## 1. Summary

The APY service is the single source of truth for yield rates across the product. It resolves per-market rates from upstreams (Morpho API, Aave pool, DefiLlama staking), caches them in Redis, persists them in Postgres, and serves them through a resolver used everywhere: deposit previews, strategy/leverage net-APY, and live position APY. Its guiding rule is **never fabricate a rate** — a number is either fresh and real, or withheld (`null` / status `"unavailable"`).

Components: `ApyResolver` (cache → DB → live fetch), protocol `adapters` (morpho / aave / staking), a background poller, and `GET /apy/*` routes.

## 2. Example Prompts

APY is not requested directly by prompt — it enriches other flows:

- "Deposit 1000 USDC split 60% Morpho 40% Aave" → blended `depositApy` in the plan response
- "Open 2x leverage on cbETH with 5 USDC" → single-leg net `apy` in the plan response
- "Loop cbETH/USDC at 60% LTV 3×" → multi-leg net `apy` in the plan response
- Positions panel → per-position `netApy` from the positions service
- Direct: `GET /apy/markets`, `GET /apy/:marketId`, `GET /apy/batch?marketIds=…`

## 3. Security & Validation

- **Freshness gating** — a cached/stored rate is only trusted if within `APY_MAX_STALENESS_MS` (default 5 min); otherwise a live fetch is attempted.
- **No fabrication** — if an upstream is missing or fails, the rate resolves `"unavailable"` and downstream APY is withheld (`null`), never guessed. A failed fetch caches nothing.
- **Known-zero vs unknown** — plain collateral tokens (WETH, cbBTC, USDC, USDbC) are recorded as a *known* 0% staking yield, distinct from "data missing".
- **Sanity bounds** — ray→APY conversion rejects values outside `[0, 200%]`.
- **All-or-nothing blends** — a blended APY (deposit legs, strategy legs) is only reported when *every* required leg resolves `"ok"`; equity ≤ 0 also withholds the number.
- **Bounded queries** — the batch endpoint accepts 1–50 market IDs.

## 4. Complete Flow

```
ApyResolver.resolve(descriptor):            // descriptor = morpho(marketKey) | staking(token)
  ├─ findOrRegister(market)                 // upsert market row keyed by marketId
  ├─ Redis getCachedRates → fresh? return
  ├─ Postgres getRates    → fresh? return
  └─ liveFetch(adapter.getRatesBatch)       // fetch, persist (DB + Redis), return
        └─ on any failure → { status: "unavailable", rates: null }

Adapters (getRatesBatch):
  • morpho   → Morpho GraphQL: supplyApy, borrowApy, Σ reward APRs
  • aave     → on-chain pool liquidity rate (ray → APY)
  • staking  → DefiLlama chart per LST pool (apyBase, apyReward); known-zero for plain tokens

Background poller: periodically refreshes tracked markets so reads stay warm and fresh.

Consumers:
  • computeDepositApy      → deposit / swapAndDeposit previews (Morpho vault netApy + Aave rate)
  • aggregateStrategyApy   → strategy & leverage net APY (per-leg collateral vs borrow)
  • PositionsService       → live per-position netApy (collateral staking − borrow cost)
```

`GET /apy/markets` returns every tracked market with latest `supplyApy / borrowApy / rewardsApy / updatedAt`; `GET /apy/:marketId` and `GET /apy/batch` serve single/batched lookups; `GET /apy/health` reports poller state. See [ApiReference](./ApiReference.md#apy-service).

## 5. Calculations

**Ray → APY** (Aave/ray-scaled per-second APR, `RAY = 1e27`, `SECONDS_PER_YEAR = 31,536,000`):
```
apr = rayValue / 1e27
apy = (1 + apr / SECONDS_PER_YEAR)^SECONDS_PER_YEAR − 1     // reject if <0 or >2.0
```

**Blended deposit APY** (bps-weighted; withheld if any leg unavailable):
```
netApy = Σ (legApy_i × bps_i) / 10000
```

**Leveraged net APY** (per-leg, summed, over equity):
```
equity   = Σ collateralValue + idleCash − Σ debtValue
netApy   = (Σ collateralValue·c + Σ debt·rewards − Σ debt·borrow) / equity
leverage = Σ collateralValue / equity
```
where `c` = collateral (staking) APY and `borrow` = market borrow APY per leg. Full derivations live in [Calculations](./Calculations.md).
