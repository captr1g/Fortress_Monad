# Pendle Prompt Execution

## 1. Summary

The Pendle pipeline lets prompts buy Pendle Principal Tokens (PT), Yield Tokens (YT), or LP, and wrap LP into a money-market-compatible wrapped LP — either standalone or as legs of a fixed-yield leverage loop. It runs inside the strategy pipeline: `StrategyService.resolvePendleMarkets()` resolves human market labels to on-chain addresses and rewrites the affected steps, `PendleMarketService` fetches executable SDK calldata, and the `PendleStrategyAdapter` (adapter ID 2) relays it on-chain.

## 2. Example Prompts

- "Swap 1 USDC to PT using Pendle Market 40acresUSDC (27 Aug 2026) on Base"
- "Buy YT with 1 USDC on Pendle Market cUSD (23 Jul 2026)"
- "Add liquidity with 1 USDC to Pendle Market 40acresUSDC (27 Aug 2026)"
- "Add liquidity with 1 USDC to Pendle Market 40acresUSDC (27 Aug 2026), then wrap the LP"
- "Swap 1 USDC to PT on Pendle 40acresUSDC (27 Aug 2026), supply PT as collateral to Morpho, borrow USDC at 80% LTV, repeat 4 times"

## 3. Security & Validation

- **Market resolution is strict** — a label ("cUSD (23 Jul 2026)") resolves by normalized asset name + exact UTC expiry day. If it matches zero or more than one market, resolution returns null and the build refuses. Expired markets are rejected with their expiry date.
- **Constrained call target** — the adapter's router relay can only call the immutable Pendle Router set at deploy; LP wrapping can only call owner-allowlisted wrapper addresses.
- **Slippage floor** — router relay enforces a strictly-positive `minAmountOut` measured as a real balance delta; a zero floor is rejected.
- **1:1 wrap verification** — the wrap sub-action requires wrapped-out to exactly equal LP-in, else revert; no silent under-mint.
- **Router revert transparency** — a failed Pendle Router call bubbles the router's original revert reason (via assembly) instead of masking it.
- **Receiver correctness** — SDK calldata is fetched with `receiver = pendleAdapter`, so Pendle sends output to the adapter, whose balance-delta check then applies before forwarding to the executor.
- **Not a "swap out of USDC" refusal** — `swapToPt/swapToYt/addLiquidityPendle` are Pendle protocol operations and are explicitly exempt from the vault's "only converts to USDC" guard.

## 4. Complete Flow

```
StrategyService.resolvePendleMarkets(intent):
  ├─ collect protocolData.pendleMarket labels
  ├─ PendleMarketService.resolveMarket(label) → { marketAddress, ptAddress, ytAddress, expiry }
  │      (reject not-found / ambiguous / expired)
  ├─ for PT-collateral loops: fetchMarketByPair(ptAddress, loanToken) → Morpho PT market
  └─ rewrite steps:
        swapToPt.tokenOut          := ptAddress
        swapToYt.tokenOut          := ytAddress
        addLiquidityPendle.tokenOut:= marketAddress (LP == market contract)
        supplyCollateral.tokenIn   := ptAddress
        Morpho steps' marketId     := the label (unified lookup key)
        wrapLp: resolve wrapper via lpWrapperFactory.wrappers(market); set tokenOut + dex

StrategyBuilder (quote pass):
  └─ PendleMarketService.fetchPtSwap / fetchYtSwap / fetchAddLiquidity
        → Pendle Convert API /v2/sdk/{chainId}/convert (receiver = pendleAdapter)
        → { calldata, expectedOut }

On-chain (PendleStrategyAdapter, adapter ID 2), data first field selects sub-action:
  sub-action 0 (router relay): abi.encode(0, tokenOut, minAmountOut, useFullBalance, routerCalldata)
  sub-action 1 (wrap LP):      abi.encode(1, wrapper, wrappedToken)
```


## 5. Calculations

**Input sizing** (same as any strategy leg):
```
consumed    = amountFixed > 0 ? amountFixed : (balance × bps / 10000)
quoteAmount = useFullBalance ? consumed × 95 / 100 : consumed
minAmountOut = protocolData.minAmountOut ?? expectedOut × 95 / 100   // must be > 0 on-chain
```

**LP wrap** — strict 1:1: `wrappedOut == lpIn` (any deviation reverts). The build projects `wrappedLP balance += lpBalance`.

**Market label parsing** — `"<asset> (DD Mon YYYY)"` or `"PT-<asset>-DDMMMYYYY"` → normalized asset + UTC expiry date; matched against Pendle's market list (5-minute in-memory cache). Convert-API `expectedOut` feeds the next leg's sizing exactly as a DEX swap would. See [Calculations](./Calculations.md#pendle-legs).
