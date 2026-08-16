# SwapStrategyAdapter

## 1. Summary

`SwapStrategyAdapter` is the FORTRESS adapter for DEX swaps, invoked as a `SWAP` step by `FortStrategyExecutor`. It relays pre-built swap calldata from an aggregator (e.g. LiFi) to an allowlisted DEX, enforces a `minAmountOut` slippage floor, and returns the output token to the executor for the next step.

It supports two input modes:
- **EXACT mode** — swaps the exact amount the executor transferred. Used for the first swap where the input is a known, fixed quantity.
- **FULL-BALANCE mode** — swaps the adapter's entire live balance of the input token, regardless of the amount baked into the calldata. Used for post-borrow swaps in leverage loops, where the exact borrowed amount is decided on-chain and may differ from the build-time estimate.

## 2. Example Prompts

Prompts that cause a `SWAP` step through this adapter:

- "Swap 100% USDC to cbETH" (as part of a supply/borrow strategy)
- "Loop cbETH/USDC on Morpho — the USDC→cbETH conversion each iteration runs here"
- "Convert the borrowed USDC back to cbETH and supply again"
- Any strategy where an intermediate token must be converted before the next step (e.g. WETH→cbETH via a regular swap)

## 3. Security Considered

- **DEX allowlist** — only owner-approved DEX addresses are callable (`UnauthorizedDex`); an arbitrary target cannot be injected via calldata.
- **Slippage floor** — output is measured as a real balance delta (`balanceAfter − balanceBefore`) and must meet `minAmountOut` (`SlippageExceeded`). This is the real protection even when full-balance mode uses calldata with a stale internal amount.
- **Swap failure handling** — a failed low-level call reverts (`SwapFailed`).
- **Approval hygiene** — the DEX is approved for exactly the input amount and the allowance is reset to zero after the swap.
- **Access control** — `onlyExecutor` gates `execute`; `Ownable` for admin; `Pausable` and `ReentrancyGuard` wrap the external call.
- **Zero-address / zero-balance guards** — DEX, output token, and (in full-balance mode) input balance are all validated.
- **Auditability** — `SwapExecuted` emits tokenIn, tokenOut, dex, amountIn, amountOut, minAmountOut.

## 4. Complete Flow

`data` encoding: `abi.encode(address dex, address tokenOut, uint256 minAmountOut, bool useFullBalance, bytes swapCalldata)`

```
executor → adapter.execute(SWAP, tokenIn, amount, _, data)
  │
  ├─ decode (dex, tokenOut, minAmountOut, useFullBalance, swapCalldata)
  ├─ require tokenOut != 0 and isApprovedDex[dex]
  │
  ├─ amountIn =
  │     useFullBalance ? balanceOf(adapter, tokenIn)   (require > 0)
  │                    : amount                        (exact, from executor)
  │
  ├─ forceApprove(tokenIn, dex, amountIn)
  ├─ balBefore = balanceOf(adapter, tokenOut)
  ├─ dex.call(swapCalldata)                            (require success)
  ├─ received = balanceOf(adapter, tokenOut) − balBefore
  ├─ require received ≥ minAmountOut                   (else SlippageExceeded)
  ├─ forceApprove(tokenIn, dex, 0)                     (reset allowance)
  ├─ transfer received tokenOut → executor
  └─ emit SwapExecuted(...)
```

The backend fetches the swap calldata from the aggregator with `fromAddress = swapAdapter`, so the DEX sends output back to this adapter, which then forwards it to the executor. In a leverage loop this adapter is the conversion half of each iteration, feeding collateral into the `MorphoStrategyAdapter` supply step.
