# Swap-and-Deposit & Bridge Execution

## 1. Summary

This pipeline covers the two LiFi-powered vault flows in the prompt path:

- **Swap-and-deposit** — accept any ERC-20, swap it to USDC via LiFi inside `FortVault.swapAndDeposit`, then deposit the USDC across registered protocols in the same transaction.
- **Bridge** — send USDC to another chain via `CrossChainRouter.depositCrossChain`, using LiFi bridge calldata.

Both are resolved in `FortressService` (`resolveSwapAndDeposit`, `resolveBridge`) off the planner intent, then simulated and returned like any other plan.

## 2. Example Prompts

Swap-and-deposit:
- "Deposit 1 WETH to Morpho"
- "Swap 0.5 cbETH and deposit to Aave"
- "Deposit 100 DAI split 70% Morpho 30% Aave"
- "Lend 500 USDbC to Morpho" (USDbC is not USDC → swap first)

Bridge:
- "Bridge 1000 USDC to Ethereum"
- "Send 500 USDC to Arbitrum"
- "Bridge 2000 USDC to Optimism"

## 3. Security & Validation

- **Swap-and-deposit min-out** — `minUsdcOut` is the greater of the intent's value or `expectedOut × 0.95`; each deposit leg's share floor is sized off the guaranteed-min USDC slice, so a bad swap can never over-promise deposits.
- **Bridge is USDC-only** — the `CrossChainRouter` only accepts USDC; destination chains are restricted to a supported set (Ethereum, Arbitrum, Optimism) with the correct destination USDC address, else the build refuses.
- **Correct swap receiver** — LiFi calldata is fetched with `fromAddress = vault` (swap-and-deposit) or `fromAddress = crossChainRouter` (bridge), so funds land where the on-chain call expects them.
- **Protocol allowlist** — deposit legs resolve against the on-chain protocol registry; unknown protocols revert the build.
- **Deadlines** — swap-and-deposit uses a 300s deadline; bridge uses 600s.
- **Tenderly pre-flight** — both flows simulate before returning.
- **Refusal boundary** — a bare "swap out of USDC to X" (not a deposit, leverage, or Pendle op) is refused by the planner, since the vault only converts *to* USDC.

## 4. Complete Flow

**Swap-and-deposit** (`resolveSwapAndDeposit`):
```
1. fetchLiFiSwapData: inputToken → USDC, fromAmount = amount, fromAddress = vault, slippage 0.5%
2. minUsdcOut = intent.minUsdcOut > 0 ? intent.minUsdcOut : expectedOut × 95/100
3. for each allocation: legUsdc = minUsdcOut × bps / 10000
                        minSharesOut = previewDeposit(protocol, legUsdc) × 0.995
4. txs = [ approve(inputToken, vault, amount),
           vault.swapAndDeposit(inputToken, amount, minUsdcOut, deadline(+300s), swapData, entries) ]
```

**Bridge** (`resolveBridge`):
```
1. resolve destination USDC by destChainId (Ethereum/Arbitrum/Optimism); refuse if unsupported
2. fetchLiFiBridgeData: USDC → destUSDC, fromAddress = crossChainRouter, toAddress = wallet
3. txs = [ approve(USDC, crossChainRouter, amount),
           crossChainRouter.depositCrossChain(amount, destChainId, lifiData, deadline(+600s)) ]
```

The LiFi `SwapData` struct (`callTo`, `approveTo = lifiDiamond`, `sendingAssetId`, `receivingAssetId`, `fromAmount`, `callData`, `requiresDeposit = true`) is assembled in `fetchLiFiSwapData`. Deposit APY is attached to swap-and-deposit responses — see [ApyService](./ApyService.md).

## 5. Calculations

**Swap-and-deposit minimums:**
```
minUsdcOut   = max(intent.minUsdcOut, expectedOut × 95 / 100)
legUsdc_i    = minUsdcOut × bps_i / 10000
minSharesOut_i = previewDeposit(protocol_i, legUsdc_i) × 9950 / 10000
```

**Bridge:** amount passes through 1:1 (USDC → destination USDC); LiFi handles routing and its own slippage (0.5%). No local share math.

**Deposit APY** for the deposited USDC uses the same blended formula as a plain deposit — see [Calculations](./Calculations.md#deposit-apy).
