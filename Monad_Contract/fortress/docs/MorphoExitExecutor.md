# MorphoExitExecutor

## 1. Summary

`MorphoExitExecutor` closes or deleverages a Morpho Blue position in a single signature using a free Morpho flash loan. It is a standalone contract (not an executor adapter) that the user authorizes on Morpho, exactly like the entry side. It supports three modes:

- **FULL_TO_LOAN** — fully close the position and return the surplus to the user in the loan token.
- **FULL_TO_COLLATERAL** — repay all debt and return the freed collateral to the user (keep the asset).
- **DELEVERAGE** — partially repay debt and withdraw collateral to a target LTV.

Because it flash-borrows the debt first, the position is unwound without the user needing upfront capital to repay, and the LTV never spikes during the unwind.

## 2. Example Prompts

Exit is button-driven from the Positions panel rather than a free-text prompt, but the intents map cleanly:

- "Close my cbETH/USDC position and give me USDC" → FULL_TO_LOAN
- "Repay all my debt but keep my cbETH" → FULL_TO_COLLATERAL
- "Deleverage my cbETH/USDC position to 30% LTV" → DELEVERAGE
- "Unwind my leverage on cbBTC" → FULL_TO_LOAN

## 3. Security Considered

- **Flash-callback authentication** — `onMorphoFlashLoan` is callable only by Morpho, and only for a loan this contract initiated: a keccak256 commitment of the flash payload is stored in EIP-1153 transient storage before the loan, verified inside the callback, and cleared. If it survives the call, the transaction reverts (`NoActiveFlash`).
- **Pre-flight validation against live state** — debt and collateral are read on-chain before the loan; `repayAssets`/`withdrawAssets`/`swapCollateralIn` are validated against the live position (`RepayExceedsDebt`, `WithdrawExceedsCollateral`, `SwapInputExceedsWithdrawn`). Fail fast, small blast radius.
- **Exact full-exit** — full modes repay by **shares**, so debt zeroes with no rounding dust.
- **DEX allowlist + slippage floor** — the unwind swap can only route through an allowlisted DEX (`UnauthorizedDex`) and must clear a strictly-positive `minLoanOut` (`SlippageExceeded`, `ZeroMinLoanOut`).
- **Repayment sufficiency** — the contract verifies it holds at least the flash amount before approving Morpho to pull it back (`InsufficientRepayment`).
- **Access & lifecycle** — `Ownable`, `Pausable`, `ReentrancyGuard`, `deadline` expiry, approval hygiene, and `rescueToken` for stranded funds.
- **Auditability** — `ExitInitiated` and `PositionExited` events record mode, amounts repaid/withdrawn, and amounts returned to the user.

## 4. Complete Flow

**Prerequisite (one-time):** `Morpho.setAuthorization(exitExecutor, true)` so the contract can repay and withdraw on the user's behalf.

**The exit transaction (one signature):**

```
User → exitExecutor.exitPosition(ExitParams p)
  │
  ├─ require now ≤ deadline, minLoanOut > 0, isApprovedDex[dex]
  ├─ accrueInterest; read position → (borrowShares, collateral)
  ├─ require borrowShares > 0 and collateral > 0
  ├─ currentDebt = sharesToAssets(borrowShares)   (rounded up)
  ├─ mode == DELEVERAGE ? (flashAssets=repayAssets, withdraw=withdrawAssets, validated)
  │                     : (flashAssets=currentDebt, withdraw=collateral)
  ├─ require swapCollateralIn ≤ withdraw
  ├─ commit keccak256(flashPayload) to transient storage
  └─ morpho.flashLoan(loanToken, flashAssets, payload)
        │
        └─ onMorphoFlashLoan(assets, data):        (only Morpho, verified commitment)
             ├─ repay: DELEVERAGE by assets, FULL by shares (debt → 0)
             ├─ withdrawCollateral(onBehalf=user, receiver=this)
             ├─ swap collateral → loanToken (allowlisted DEX, ≥ minLoanOut)
             ├─ require loanBalance ≥ assets      (InsufficientRepayment)
             ├─ approve Morpho to pull `assets` back
             ├─ send surplus loanToken to user    (FULL_TO_LOAN / DELEVERAGE)
             └─ send leftover collateral to user  (FULL_TO_COLLATERAL keeps the asset)
  │
  └─ require flash commitment cleared (else NoActiveFlash)
```

The net effect: debt repaid, collateral freed, flash loan settled from swap proceeds, and any surplus (loan token and/or collateral) returned to the user — all atomically.
