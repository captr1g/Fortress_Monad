# Morpho Leverage Execution

## 1. Summary

The leverage pipeline turns a single-asset, exact-multiplier prompt ("open 2x leverage on cbETH with 1 USDC") into one flash-loan transaction against `MorphoLeverageExecutor`. The user provides equity in the loan token; the contract flash-borrows the leverage, swaps the full size into collateral, supplies it, and borrows exactly the flash amount — opening the position at the precise multiplier with no mid-construction LTV spike.

Entry point: `POST /fortress/plan` → `FortressService.plan()` → (intent.action === "leverage") → `LeverageService.buildLeverage()`. The response includes a net-APY preview.

## 2. Example Prompts

- "Open 2x leverage on cbETH with 1 USDC"
- "Long cbETH 2x with 10 USDC"
- "Open 2x leverage on wstETH with 5 USDC"
- "Leverage 20 USDC into cbETH at 2x"

The planner sets `inputToken` (equity = the market loan token, e.g. USDC), `collateralToken` (asset to lever), `inputAmount`, and `multiplier` (1–10). Explicit multi-step loops and Pendle PT loops route to the [strategy pipeline](./StrategyExecution.md) instead.

## 3. Security & Validation

- **Input token must equal the market loan token** — the contract pulls the loan token as equity, so the backend rejects a mismatch.
- **Distinct tokens & valid multiplier** — input ≠ collateral, and `multiplier > 1` (else the flash amount is zero and the build refuses).
- **Market headroom filter** — `fetchMarketByPair` only accepts markets whose LLTV clears `targetLtv + 2%`; if none qualify, the build refuses.
- **Pre-flight worst-case LTV check** — using the *minimum* collateral the swap may yield, the backend computes the worst-case LTV and refuses if it meets or exceeds the market LLTV, with a clear "lower the multiplier" message. Morpho's own health check is the on-chain backstop.
- **Slippage floor** — `minCollateralOut = expectedOut × 0.995`, required to be > 0; the contract reverts if the entry swap underperforms.
- **Exact-borrow settlement** — the contract borrows exactly the (0-fee) flash amount to repay; slippage is absorbed into the final LTV, not the debt.
- **Setup hygiene** — an ERC-20 approve for the exact equity and a Morpho `setAuthorization` (only if not already authorized) precede the `openLeverage` call.
- **Central simulation** — `LeverageService` returns a `BuildResult`; `plan.service` runs the Tenderly bundle simulation.

## 4. Complete Flow

```
LeverageService.buildLeverage(intent, wallet):
  1. validate input ≠ collateral, multiplier > 1, inputAmount > 0
  2. targetLtv = 1 − 1/multiplier
  3. resolveMarket: fetchMarketByPair(collateral, loan, targetLtv)  (or bytes32 marketId)
  4. require market.loanToken == inputToken
  5. flashAssets = inputAmount × (multiplierBps − 10000) / 10000
     swapIn      = inputAmount + flashAssets
  6. fetchEntryQuote (LiFi): loan → collateral, fromAmount = swapIn, fromAddress = leverageExecutor
  7. minCollateralOut = expectedOut × 9950 / 10000    (require > 0)
  8. price = oracle.price();  assertHealthy(worst-case LTV < LLTV)
  9. build txs:
        approve(loanToken, leverageExecutor, inputAmount)
        setAuthorization(morphoBlue, leverageExecutor, true)   // if not already authorized
        openLeverage(LeverageParams{ market, inputAssets, flashAssets, minCollateralOut, dex, swapCalldata, deadline })
 10. computeApy(market, expectedCollateralValue, flashAssets)   → StrategyApy
  └─ return BuildResult { transactions, description, apy }

plan.service → FortressSimulator.simulate(transactions, wallet) → response
```


## 5. Calculations

For a multiplier `L` on equity `E` (loan-token units), `multiplierBps = round(L × 10000)`:
```
flashAssets      = E × (multiplierBps − 10000) / 10000     // = (L − 1)·E
swapIn           = E + flashAssets                          // = L·E
targetLtv        = 1 − 1/L
minCollateralOut = expectedCollateralOut × 9950 / 10000     // 0.5% slippage floor, must be > 0
```

**Pre-flight worst-case health check** (uses the min collateral, 1e36 oracle scale, 1e18 WAD):
```
collateralValue = minCollateralOut × price / 1e36           // loan-token units
worstLtvWad     = flashAssets × 1e18 / collateralValue
refuse if worstLtvWad ≥ market.lltv
```

**Net APY preview** (values expected collateral, then single-leg `aggregateStrategyApy`):
```
collateralValue = expectedCollateralOut × price / 1e36
debtValue       = flashAssets
equity          = collateralValue − debtValue
netApy          = (collateralValue × collateralApy + debtValue × rewardsApy − debtValue × borrowApy) / equity
leverage        = collateralValue / equity
```
`collateralApy` = collateral staking rate, `borrowApy` = market borrow rate. Withheld (status "unavailable") unless both resolve fresh. Full derivation: [Calculations](./Calculations.md#leverage--strategy-net-apy).
