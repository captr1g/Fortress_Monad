# MorphoLeverageExecutor

## 1. Summary

`MorphoLeverageExecutor` opens a leveraged Morpho Blue position at an **exact multiplier** in a single signature, using a free Morpho flash loan. It is a standalone contract (not an executor adapter) that the user authorizes on Morpho. The user supplies equity in the loan token; the contract flash-borrows the leverage, swaps the full size into collateral, supplies it, borrows exactly the flash amount, and settles the loan — all atomically.

For a multiplier `L` on equity `E`: `flashAssets = (L − 1)·E`, total swap input `= L·E`, final debt `= flashAssets`, and final LTV `= 1 − 1/L`. Because the full collateral is supplied before borrowing, the intermediate LTV never exceeds the final LTV — there is no liquidation risk mid-construction.

## 2. Example Prompts

- "Open 2x leverage on cbETH with 1 USDC"
- "Long cbETH 2x with 10 USDC"
- "Open 2x leverage on wstETH with 5 USDC"
- "Leverage 20 USDC into cbETH at 2x"

The backend requires the input token to be the market's loan token (typically USDC), the collateral token to be the asset being levered, and a multiplier of 1–10. It also runs a pre-flight worst-case-LTV health check before the transaction is offered for signing.

## 3. Security Considered

- **Flash-callback authentication** — `onMorphoFlashLoan` is callable only by Morpho, and only for a loan this contract initiated: a keccak256 commitment of the flash payload is stored in EIP-1153 transient storage before the loan, verified in the callback, and cleared. If it survives, the transaction reverts (`NoActiveFlash`).
- **Exact-borrow settlement** — the contract borrows exactly `flashAssets` (the 0-fee flash amount) to repay the loan; slippage is absorbed into the final LTV, not into the debt.
- **DEX allowlist + collateral floor** — the entry swap can only route through an allowlisted DEX (`UnauthorizedDex`) and must produce at least `minCollateralOut > 0` (`SlippageExceeded`, `ZeroMinCollateralOut`).
- **Morpho as final backstop** — the borrow is `onBehalf` of the user, so Morpho's own health check reverts an over-leveraged borrow atomically. The backend's pre-flight LTV check is an early, friendly failure; Morpho is the authoritative guard.
- **Input validation** — non-zero equity and non-zero flash amount are required (`ZeroInputAssets`, `ZeroFlashAssets`); `deadline` rejects stale transactions.
- **Repayment sufficiency** — verifies it holds at least the flash amount before approving Morpho to pull it back (`InsufficientRepayment`).
- **Residual sweep** — any leftover loan token or collateral after construction is returned to the user.
- **Access & lifecycle** — `Ownable`, `Pausable`, `ReentrancyGuard`, approval hygiene, `rescueToken`.
- **Auditability** — `LeverageInitiated` and `PositionLevered` events record equity, flash amount, collateral supplied, debt opened, and residuals returned.

## 4. Complete Flow

**Prerequisites (signed as part of the plan):**
1. `loanToken.approve(leverageExecutor, inputAssets)` — lets the contract pull the equity.
2. `Morpho.setAuthorization(leverageExecutor, true)` — lets it supply/borrow on the user's behalf (only if not already set).

**The leverage transaction (one signature):**

```
User → leverageExecutor.openLeverage(LeverageParams p)
  │
  ├─ require now ≤ deadline, inputAssets > 0, flashAssets > 0,
  │         minCollateralOut > 0, isApprovedDex[dex]
  ├─ pull inputAssets of loanToken from the user (equity)
  ├─ commit keccak256(flashPayload) to transient storage
  └─ morpho.flashLoan(loanToken, flashAssets, payload)
        │
        └─ onMorphoFlashLoan(assets, data):        (only Morpho, verified commitment)
             ├─ swap (inputAssets + assets) loanToken → collateral
             │      via allowlisted DEX, require received ≥ minCollateralOut
             ├─ supplyCollateral(all received, onBehalf=user)
             ├─ borrow exactly `assets` of loanToken (onBehalf=user, receiver=this)
             │      → Morpho enforces final health; over-leverage reverts here
             ├─ require loanBalance ≥ assets        (InsufficientRepayment)
             ├─ approve Morpho to pull `assets` back (settle flash loan)
             ├─ sweep any residual loan token to the user
             └─ sweep any residual collateral to the user
  │
  └─ require flash commitment cleared (else NoActiveFlash)
```

The net effect: the user ends with a leveraged Morpho position (collateral ≈ `L·E`, debt = `(L−1)·E`) under their own account, opened at exactly the requested multiplier, with the LTV never spiking during construction. The position and its net APY then surface through the FORTRESS positions service.
