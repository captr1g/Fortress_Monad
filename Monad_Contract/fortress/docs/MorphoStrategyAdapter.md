# MorphoStrategyAdapter

## 1. Summary

`MorphoStrategyAdapter` is the FORTRESS adapter for Morpho Blue lending actions, invoked as a step by `FortStrategyExecutor`. It performs four actions on behalf of the user: `supplyCollateral`, `borrow`, `repay`, and `withdrawCollateral`. All actions run `onBehalf` of the user, so the resulting collateral and debt live under the user's own Morpho account (never the adapter's).

Its defining feature is **on-chain borrow sizing**. The backend passes a *target LTV*, not a fixed borrow amount. At execution time the adapter reads the user's real collateral and the market's live oracle price, then borrows exactly the gap needed to reach that LTV. This makes borrows immune to swap slippage (it sizes against the collateral that actually landed) and immune to decimal/price mistakes (the price comes from the same oracle Morpho uses for liquidation).

## 2. Example Prompts

Prompts that cause this adapter to be invoked (as `supplyCollateral` / `borrow` / `repay` / `withdrawCollateral` steps):

- "Supply 0.002 cbETH as collateral to Morpho cbETH-USDC and borrow USDC at 50% LTV"
- "Loop cbETH/USDC on Morpho at 60% LTV, 3 times, starting with 100 USDC"
- "Borrow USDC against my cbBTC at 55% LTV"
- "Repay my USDC debt on the cbETH-USDC market"

## 3. Security Considered

- **Target-LTV validation** — the requested LTV must be non-zero and strictly below the market LLTV; Morpho's own health check remains the final backstop and reverts an unhealthy borrow.
- **Live, exact debt accounting** — `accrueInterest` is called before reading the position, and existing debt is converted from borrow shares to assets rounding **up** against the borrower (exactly as Morpho does), so borrows never over-shoot due to stale or under-counted debt.
- **Oracle safety** — a zero oracle price reverts (`OraclePriceZero`); missing collateral reverts (`NoCollateral`); if the position is already at/above target the step reverts (`NothingToBorrow`) rather than pushing LTV past target.
- **Defense-in-depth ceiling** — a backend-supplied `maxBorrow` caps the borrow, so a bad oracle read or stale state can never borrow more than the user was shown (`BorrowExceedsCeiling`).
- **Access control** — `onlyExecutor` gates `execute`; `Ownable` for admin; `Pausable` and `ReentrancyGuard` wrap the external Morpho/token calls.
- **Approval hygiene** — allowances to Morpho are set for the exact amount and reset to zero after each supply/repay.
- **Auditability** — `BorrowExecuted` emits the full sizing decision (collateral, collateral value, target LTV, target debt, current debt, borrowed).

## 4. Complete Flow

The adapter is never called directly — the executor routes a step to it. Encoding per action:

| Action | `data` encoding |
|--------|-----------------|
| SUPPLY_COLLATERAL | `abi.encode(MarketParams)` |
| BORROW | `abi.encode(MarketParams, targetLtvWad, maxBorrow, minBorrow)` |
| REPAY | `abi.encode(MarketParams)` |
| WITHDRAW_COLLATERAL | `abi.encode(MarketParams, withdrawAmount)` |

**Borrow (the on-chain-sized path):**

```
executor → adapter.execute(BORROW, _, 0, user, data)
  │
  ├─ decode (MarketParams, targetLtvWad, maxBorrow, minBorrow)
  ├─ require targetLtvWad ∈ (0, lltv)
  ├─ morpho.accrueInterest(params)
  ├─ read position(id, user) → (borrowShares, collateral)
  ├─ require collateral > 0
  ├─ price = oracle.price(); require price > 0
  ├─ collateralValue = collateral × price / 1e36        (loan-token units)
  ├─ targetDebt      = collateralValue × targetLtv / 1e18
  ├─ currentDebt     = sharesToAssets(borrowShares)      (rounded up)
  ├─ require targetDebt > currentDebt                    (else NothingToBorrow)
  ├─ borrowAmount = targetDebt − currentDebt
  ├─ require borrowAmount ≤ maxBorrow                    (else BorrowExceedsCeiling)
  ├─ morpho.borrow(params, borrowAmount, 0, onBehalf=user, receiver=adapter)
  ├─ transfer borrowed loan token → executor            (next step can use it)
  └─ emit BorrowExecuted(...)
```

**Supply / Repay:** executor sends the token → adapter approves Morpho for the exact amount → `supplyCollateral` / `repay(onBehalf=user)` → approval reset to 0 → no liquid output.

**Withdraw collateral:** `withdrawCollateral(onBehalf=user, receiver=executor)` → collateral lands in the executor for the next step.

In a leverage loop this adapter is the `SUPPLY → BORROW` half of each iteration; the `SwapStrategyAdapter` converts the borrowed token back into collateral between iterations.
