# Calculations Reference

Every quantitative formula the backend uses, in one place. Each execution doc links here for its derivations. All token amounts are in smallest units unless noted.

## Scales & Constants

| Symbol | Value | Meaning |
|--------|-------|---------|
| `WAD` | `1e18` | LTV and fractional scale |
| `ORACLE_PRICE_SCALE` | `1e36` | Morpho oracle price scale |
| `RAY` | `1e27` | Aave per-second APR scale |
| `SECONDS_PER_YEAR` | `31,536,000` | APY compounding period |
| `SLIPPAGE_BPS` | `9950` | 0.5% tolerance on vault preview minimums |
| `MIN_OUT_BPS` | `9950` | 0.5% floor on exit / leverage swap output |
| swap `minOut` | `× 95/100` | 5% floor on strategy swap legs (build-time) |
| `BORROW_CEILING_PADDING_BPS` | `300` | +3% ceiling above projected borrow |
| `VIRTUAL_SHARES / VIRTUAL_ASSETS` | `1e6 / 1` | Morpho share↔asset rounding |

**Oracle valuation** (collateral → loan-token units):
```
collateralValue = collateral × oraclePrice / 1e36
```

**LTV to WAD:** `targetLtvWad = round(targetLtv × 1e18)`

**Morpho debt (shares → assets, rounded up against the borrower):**
```
debt = ceil(borrowShares × (totalBorrowAssets + 1) / (totalBorrowShares + 1e6))
```

## Swap Leg Sizing

Mirrors the on-chain executor (`balance × bps / 10000`):
```
consumed     = amountFixed > 0 ? amountFixed : (balance × bps / 10000)
quoteAmount  = useFullBalance ? consumed × 95 / 100 : consumed   // headroom for chained/post-borrow swaps
minAmountOut = protocolData.minAmountOut ?? expectedOut × 95 / 100
```
`useFullBalance` swaps quote at 95% so the baked-in `fromAmount` never exceeds the real landed balance.

## Borrow Leg Sizing

Backend projection (the `MorphoStrategyAdapter` re-derives authoritatively on-chain from live collateral):
```
collateralValue    = collateral × oraclePrice / 1e36
targetDebt         = collateralValue × targetLtvWad / 1e18
incrementalBorrow  = max(targetDebt − currentDebt, 0)
maxBorrow (ceiling)= borrowCeiling ?? incrementalBorrow × (10000 + 300) / 10000
minBorrow (floor)  = incrementalBorrow × 100 / 10000
```
The adapter requires `targetLtvWad ∈ (0, market.lltv)` and reverts if the sized borrow exceeds `maxBorrow`.

## Pendle Legs

Input sizing is identical to a swap leg (above). The Convert-API `expectedOut` feeds the next leg's sizing exactly as a DEX swap would. LP wrap is strict 1:1:
```
wrappedOut == lpIn        // any deviation reverts on-chain
minAmountOut > 0          // enforced on router relay
```
Market labels parse to `{ asset, expiryUTCDay }` and must match exactly one live Pendle market.

## Deposit APY

Per-protocol source, then bps-weighted blend (withheld if any leg unavailable):
```
Morpho leg : MetaMorpho vault netApy (Morpho API)
Aave leg   : rayToApy(pool.currentLiquidityRate)
netApy     = Σ (legApy_i × bps_i) / 10000       // only when every leg resolves "ok"
```

**rayToApy:**
```
apr = rayValue / 1e27
apy = (1 + apr / 31,536,000)^31,536,000 − 1     // reject if <0 or >2.0
```

## Leverage & Strategy Net APY

The single model for leveraged economics across any number of markets (`aggregateStrategyApy`). Per leg, values in loan-token units:
```
equity   = Σ collateralValue + idleCash − Σ debtValue
earn     = Σ (collateralValue_i × c_i) + Σ (debtValue_i × rewards_i)
cost     = Σ (debtValue_i × borrow_i)
netApy   = (earn − cost) / equity                     // withheld if equity ≤ 0 or any rate missing
leverage = Σ collateralValue / equity
```
- `c_i`  = collateral (staking) APY for leg `i` (0 for plain assets like WETH)
- `borrow_i` = market borrow APY; `rewards_i` = market reward APR credited on debt
- `idleCash` = borrowed loan token not redeployed into collateral

**Single-leg cases** (leverage entry, one-market loop) reduce to:
```
netApy = (collateralValue × c + debt × rewards − debt × borrow) / (collateralValue − debt)
```
For a clean `L`× position with no rewards and collateral value `L·E`, debt `(L−1)·E`, equity `E`:
```
netApy ≈ L × c − (L − 1) × borrow
```
This is why an LST at 2× can be net-positive while a zero-yield asset (WETH) is net-negative.

## Exit Amounts

`collateralForLoanValue(v) = v × collateral / collateralValue`.

**full_to_loan:** `collateralToSell = collateral`, `flashAssets = debt`.

**full_to_collateral:**
```
debtWithBuffer     = debt × 10100 / 10000                    // +1% swap slippage
collateralToSell   = collateralForLoanValue(debtWithBuffer)  // ≤ collateral
collateralReturned = collateral − collateralToSell
```

**deleverage to targetLtv** — selling collateral shrinks both debt and collateral, so solving `debt − r = targetLtv × (collateralValue − r)`:
```
targetDebt     = collateralValue × targetLtvWad / 1e18       // must be < current debt
repayAssets    = (debt − targetDebt) × 1e18 / (1e18 − targetLtvWad)
withdrawAssets = collateralForLoanValue(repayAssets × 10100 / 10000)   // +1% buffer, ≤ collateral
flashAssets    = repayAssets
```

**Exit swap floor & coverage:**
```
minLoanOut = expectedOut × 9950 / 10000     // > 0
require expectedOut ≥ flashAssets
```

## Leverage Entry (sizing + health)

For multiplier `L` on equity `E`, `multiplierBps = round(L × 10000)`:
```
flashAssets      = E × (multiplierBps − 10000) / 10000     // (L−1)·E
swapIn           = E + flashAssets                          // L·E
targetLtv        = 1 − 1/L
minCollateralOut = expectedCollateralOut × 9950 / 10000     // > 0
```

**Pre-flight worst-case LTV** (uses the min collateral floor):
```
collateralValue = minCollateralOut × price / 1e36
worstLtvWad     = flashAssets × 1e18 / collateralValue
refuse if worstLtvWad ≥ market.lltv
```
