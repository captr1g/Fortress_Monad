# PendleStrategyAdapter

## 1. Summary

`PendleStrategyAdapter` is the FORTRESS adapter for Pendle operations, invoked as a `SWAP` step by `FortStrategyExecutor`. It exposes two sub-actions, selected by the first field of the encoded data:

- **Sub-action 0 — Router relay:** relays pre-built Pendle SDK calldata to the immutable Pendle RouterV4 to buy a Principal Token (PT), a Yield Token (YT), or add liquidity (LP). Supports EXACT and FULL-BALANCE input modes.
- **Sub-action 1 — Wrap LP:** wraps a Pendle LP token into a wrapped LP token (1:1) via an allowlisted `PendleLPWrapper`, making the LP usable as collateral in money markets like Morpho.

This is what enables fixed-yield PT collateral loops and Pendle LP strategies on top of the standard executor pipeline.

## 2. Example Prompts

- "Swap 1 USDC to PT using Pendle Market 40acresUSDC (27 Aug 2026) on Base"
- "Buy YT with 1 USDC on Pendle Market cUSD (23 Jul 2026)"
- "Add liquidity with 1 USDC to Pendle Market 40acresUSDC (27 Aug 2026)"
- "Add liquidity with 1 USDC to Pendle Market 40acresUSDC (27 Aug 2026), then wrap the LP"
- "Swap 1 USDC to PT on Pendle 40acresUSDC (27 Aug 2026), supply PT as collateral, borrow USDC at 80% LTV, repeat 4 times"

## 3. Security Considered

- **Constrained call targets** — the router relay can only call the immutable `pendleRouter` set at construction; LP wrapping can only call owner-allowlisted wrapper addresses (`UnauthorizedWrapper`). Arbitrary targets cannot be injected.
- **Slippage floor** — router relay enforces a strictly-positive `minAmountOut` measured as a real balance delta (`SlippageExceeded`); a zero floor is rejected (`ZeroMinAmountOut`).
- **1:1 wrap verification** — the wrap sub-action requires the wrapped amount received to exactly equal the LP amount in; any deviation reverts, so a non-compliant wrapper cannot silently mint less.
- **Router revert transparency** — a failed router call bubbles the router's original revert reason via assembly instead of masking it, preserving debuggability and monitoring.
- **Access control** — `onlyExecutor` gates `execute`; `Ownable` for admin; `Pausable` and `ReentrancyGuard` wrap the external calls.
- **Approval hygiene** — the router/wrapper is approved for the exact input and reset to zero after the operation.
- **Auditability** — `PendleSwapExecuted` and `LpWrapped` events record every operation.

## 4. Complete Flow

`data` encoding (first field selects the sub-action):

| Sub-action | Encoding |
|-----------|----------|
| 0 — Router relay | `abi.encode(uint8(0), tokenOut, minAmountOut, useFullBalance, routerCalldata)` |
| 1 — Wrap LP | `abi.encode(uint8(1), wrapper, wrappedToken)` |

**Sub-action 0 — Router relay (buy PT / YT / LP):**

```
executor → adapter.execute(SWAP, tokenIn, amount, _, data)
  │
  ├─ subAction = 0
  ├─ decode (tokenOut, minAmountOut, useFullBalance, routerCalldata)
  ├─ require tokenOut != 0 and minAmountOut > 0
  ├─ amountIn = useFullBalance ? balanceOf(adapter, tokenIn) : amount
  ├─ forceApprove(tokenIn, pendleRouter, amountIn)
  ├─ balBefore = balanceOf(adapter, tokenOut)
  ├─ pendleRouter.call(routerCalldata)      (on failure: bubble router revert)
  ├─ received = balanceOf(adapter, tokenOut) − balBefore
  ├─ require received ≥ minAmountOut
  ├─ forceApprove(tokenIn, pendleRouter, 0)
  ├─ transfer received tokenOut → executor
  └─ emit PendleSwapExecuted(...)
```

**Sub-action 1 — Wrap LP:**

```
executor → adapter.execute(SWAP, lpToken, _, _, data)
  │
  ├─ subAction = 1
  ├─ decode (wrapper, wrappedToken); require both != 0 and isApprovedWrapper[wrapper]
  ├─ amountIn = balanceOf(adapter, lpToken); require > 0
  ├─ forceApprove(lpToken, wrapper, amountIn)
  ├─ wrapper.wrap(receiver=adapter, amountIn)
  ├─ received = balanceOf(adapter, wrappedToken) − balBefore
  ├─ require received == amountIn           (strict 1:1)
  ├─ forceApprove(lpToken, wrapper, 0)
  ├─ transfer wrappedToken → executor
  └─ emit LpWrapped(...)
```

The backend resolves Pendle market labels to PT/YT/LP addresses and the wrapper address (via the LP wrapper factory), rewrites the affected steps, and fetches the router calldata from the Pendle SDK with the adapter as receiver so output routes back correctly.
