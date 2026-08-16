# Strategy Prompt Execution

## 1. Summary

The strategy pipeline turns a multi-step natural-language request ("loop cbETH/USDC at 60% LTV three times") into a single atomic transaction against `FortStrategyExecutor`. The backend's `StrategyService` resolves markets, sizes every leg, fetches live DEX/Pendle calldata, and hands `StrategyBuilder` an ordered list of on-chain steps. The result is a `BuildResult` (approve + execute transactions, plus an optional Morpho authorization setup tx) that is simulated on Tenderly before being returned for signing.

Entry point: `POST /fortress/plan` → `FortressService.plan()` → (intent.action === "strategy") → `StrategyService.resolveStrategy()`.

## 2. Example Prompts

- "Supply 0.002 cbETH as collateral to Morpho cbETH-USDC, borrow USDC at 50% LTV, swap to cbETH, supply again — repeat 3 times"
- "Loop cbETH/USDC on Morpho at 60% LTV, 4 times, starting with 100 USDC"
- "Supply cbETH and cbBTC as collateral, borrow USDC against both at 50% LTV"
- "Swap 1 USDC to PT using Pendle Market 40acresUSDC (27 Aug 2026), supply PT as collateral, borrow USDC at 80% LTV, repeat 4 times"

Single-asset one-shot leverage ("open 2x leverage on cbETH") is routed to the dedicated leverage pipeline instead — see [LeverageExecution](./LeverageExecution.md).

## 3. Security & Validation

- **On-chain borrow sizing** — the backend never sends a fixed borrow amount. It passes a target LTV; the `MorphoStrategyAdapter` reads live collateral and the market oracle at execution and borrows the exact gap. This is immune to swap slippage and price/decimal mistakes.
- **Defense-in-depth ceiling** — every borrow step carries a `maxBorrow` cap (`incrementalBorrow × 1.03`, or an explicit `borrowCeiling`); the adapter reverts if the on-chain-sized borrow would exceed it.
- **Pre-build validation** — `validateStrategy` checks step ordering and market references; a borrow can only be sized against collateral supplied to the same market earlier in the sequence.
- **Oracle safety** — every market that holds collateral or carries debt must return a non-zero oracle price, else the build refuses (never guesses a price).
- **Slippage floors** — each swap leg carries `minAmountOut` (explicit or `expectedOut × 0.95`); the swap adapter measures a real balance delta and reverts on shortfall.
- **Atomicity** — the whole `Step[]` runs in one transaction; any revert unwinds everything, leaving the user's input untouched.
- **Setup pruning** — the Morpho `setAuthorization` and the ERC-20 approve are dropped when already satisfied on-chain (`filterAuthorizationTxs`, `filterApprovalTx`), so no redundant signatures.
- **Tenderly pre-flight** — the full bundle is simulated; the response carries `simulation.success` and `gasUsed`.
- **Bounded work** — `MAX_STEPS = 30` on-chain; the intent schema caps at 30 steps.

## 4. Complete Flow

```
POST /fortress/plan { prompt, walletAddress }
  │
  ├─ FortressPlanner.extractIntent(prompt)      → OpenAI (temp 0, json), Zod-validated Intent
  │
  ├─ StrategyService.resolveStrategy(intent, wallet):
  │   1. resolveInputAmount        — "0" means "use full wallet balance" (on-chain read)
  │   2. resolvePendleMarkets      — resolve Pendle labels → PT/YT/LP + Morpho PT market;
  │                                   rewrite swapToPt.tokenOut, supply.tokenIn, marketId
  │   3. resolve COLLATERAL-LOAN labels → MorphoMarketParams (via Morpho GraphQL)
  │   4. default each borrow's targetLtv from the top-level value
  │   5. mark chained/post-borrow swaps useFullBalance = true
  │   6. pin entry-swap amounts to exact fractions of the original input
  │   7. validateStrategy(steps, markets, targetLtv)
  │   8. fetch oracle price for every collateral / borrow market (reject zero)
  │   9. fetchExistingPosition for each borrow market (seed projection)
  │  10. StrategyBuilder.build(...)  → transactions, setupTxs, projection
  │  11. filterAuthorizationTxs + filterApprovalTx (drop redundant setup)
  │  12. computeApy(projection)      → StrategyApy
  │
  ├─ FortressSimulator.simulate(transactions, wallet)   → Tenderly bundle
  └─ return { intent, description, transactions, simulation, apy }
```

**StrategyBuilder — two passes:**
1. *Quote pass:* walk the steps in order, fetching LiFi/Pendle calldata sequentially so each swap is sized off the previous swap's real `expectedOut`, and projecting balances/collateral/debt as it goes.
2. *Encode pass:* encode each step into an `OnChainStep { adapterId, action, tokenIn, bps, amountFixed, data }`, using adapter IDs `swap=0, morpho=1, pendle=2`.

**Transactions returned:** `[approve(inputToken, executor, MAX_UINT256), executeStrategy(...)]`, prefixed by a Morpho `setAuthorization(morphoAdapter, true)` setup tx when the strategy touches Morpho and it isn't already authorized.

## 5. Calculations

All amounts are in each token's smallest units; LTV/WAD are 1e18-scaled; Morpho oracle prices are 1e36-scaled.

**Swap leg sizing** (mirrors the on-chain executor's `balance × bps / 10000`):
```
consumed    = amountFixed > 0 ? amountFixed : (balance × bps / 10000)
quoteAmount = useFullBalance ? consumed × 95 / 100 : consumed      // 5% headroom for chained swaps
minAmountOut = protocolData.minAmountOut ?? expectedOut × 95 / 100
```

**Borrow leg sizing** (backend projection; the contract re-derives authoritatively):
```
collateralValue   = collateral × oraclePrice / 1e36          // loan-token units
targetDebt        = collateralValue × targetLtvWad / 1e18
incrementalBorrow = max(targetDebt − currentDebt, 0)
maxBorrow (ceiling)= borrowCeiling ?? incrementalBorrow × (10000 + 300) / 10000   // +3%
minBorrow (floor)  = incrementalBorrow × 100 / 10000                              // 1%
targetLtvWad       = round(targetLtv × 1e18)
```

**Net APY across all legs** — see the leverage/APY formula in [Calculations](./Calculations.md#leverage--strategy-net-apy); computed via `aggregateStrategyApy` over each market leg plus idle borrowed cash.
