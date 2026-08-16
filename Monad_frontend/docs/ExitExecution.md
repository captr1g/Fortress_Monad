# Morpho Exit Execution

## 1. Summary

The exit pipeline unwinds an open Morpho leverage position in one signature via a flash loan against `MorphoExitExecutor`. It supports three modes: fully close and receive the loan token (`full_to_loan`), repay all debt and keep the collateral (`full_to_collateral`), or partially deleverage to a target LTV (`deleverage`). The backend reads the live position, computes per-mode amounts, fetches the unwind swap calldata, simulates, and returns a ready-to-sign transaction plus a settlement preview.

Exit is button-driven, not prompt-driven: `POST /fortress/exit` → `ExitService.buildExit()`. A companion `GET /fortress/position` reads a single market position.

## 2. Example Prompts

Mapped from the Positions panel buttons rather than free text:

- "Close my cbETH/USDC position and give me USDC" → `full_to_loan`
- "Repay all my debt but keep my cbETH" → `full_to_collateral`
- "Deleverage my cbETH/USDC position to 30% LTV" → `deleverage` (targetLtv 0.30)
- "Unwind my leverage on cbBTC" → `full_to_loan`

## 3. Security & Validation

- **Live-state sizing** — `full_*` modes read debt and collateral on-chain; the contract re-reads both, so the amounts are exact, not estimates. `deleverage` amounts are validated against the live position.
- **Underwater guard** — `full_to_collateral` computes the collateral needed to cover debt (+1% buffer) and refuses if it exceeds the actual collateral.
- **Deleverage sanity** — refuses if the target debt is not below current debt ("nothing to deleverage") and if the required withdrawal exceeds collateral.
- **Debt coverage** — the unwind swap output must cover the debt to repay, else the build refuses before signing.
- **Flash-callback authentication** — the on-chain callback is Morpho-only and validated against a transient-storage commitment of the flash payload.
- **DEX allowlist + slippage floor** — the unwind swap routes only through an allowlisted DEX and must clear `minLoanOut = expectedOut × 0.995` (> 0).
- **Exact full-exit** — full modes repay by shares, zeroing debt with no rounding dust.
- **Authorization pruning** — a Morpho `setAuthorization(exitExecutor, true)` is prepended only when not already authorized.

## 4. Complete Flow

```
GET  /fortress/position?walletAddress&market   → ExitService.readPositionForMarket → PositionView
POST /fortress/exit { walletAddress, market, mode, targetLtv? }

ExitService.buildExit(req):
  1. resolveMarket(req.market)          — bytes32 id or "COLLATERAL-LOAN" label
  2. readPosition(...)                  — collateral, debt, collateralValue, ltv, lltv
     require debt > 0 and collateral > 0
  3. computeExitAmounts(mode, position, targetLtv)
        → repayAssets, withdrawAssets, collateralToSell, collateralReturned
  4. fetchUnwindQuote (LiFi): collateral → loan, fromAmount = collateralToSell,
        fromAddress = morphoExitExecutor
  5. minLoanOut = expectedOut × 9950/10000  (require > 0)
     flashAssets = (deleverage ? repayAssets : position.debt)
     require expectedOut ≥ flashAssets
  6. authorizationTxs(wallet)           — prepend setAuthorization if needed
  7. encode exitPosition(ExitParams{ market, mode, repayAssets, withdrawAssets,
        swapCollateralIn = collateralToSell, minLoanOut, dex, swapCalldata, deadline })
  8. simulate(transactions, wallet)
  └─ return { description, transactions, simulation, position, settlement }
```

## 5. Calculations

Notation: `WAD = 1e18`, oracle price 1e36-scaled, `MIN_OUT_BPS = 9950`.

**Collateral needed to cover a loan value:**
```
collateralForLoanValue(loanValue) = loanValue × collateral / collateralValue
```

**full_to_loan** — sell all collateral, repay all debt (flash = full debt):
```
collateralToSell = collateral;  flashAssets = position.debt
```

**full_to_collateral** — repay all debt, keep the rest:
```
debtWithBuffer   = debt × 10100 / 10000                 // +1% for swap slippage
collateralToSell = collateralForLoanValue(debtWithBuffer)   // must be ≤ collateral
collateralReturned = collateral − collateralToSell
```

**deleverage to target LTV** — selling collateral shrinks both sides, so:
```
targetLtvWad = round(targetLtv × 1e18)
targetDebt   = collateralValue × targetLtvWad / 1e18        // must be < current debt
repayAssets  = (debt − targetDebt) × 1e18 / (1e18 − targetLtvWad)
withdrawAssets = collateralForLoanValue(repayAssets × 10100 / 10000)   // +1% buffer, ≤ collateral
flashAssets  = repayAssets
```

**Unwind swap floor & coverage:**
```
minLoanOut = expectedOut × 9950 / 10000                 // require > 0
require expectedOut ≥ flashAssets                        // swap must cover the debt
```
See [Calculations](./Calculations.md#exit-amounts) for the deleverage algebra derivation.
