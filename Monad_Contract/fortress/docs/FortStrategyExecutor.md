# FortStrategyExecutor

## 1. Summary

`FortStrategyExecutor` is the atomic, single-signature execution engine at the center of FORTRESS. It takes one input token from the user and runs an ordered array of DeFi steps — swap, supply collateral, borrow, repay, withdraw — inside a single transaction. Each step is routed to a registered protocol adapter (Morpho, Swap/LiFi, Pendle), and the output of one step automatically feeds the next through live on-chain balance reads. The executor holds tokens only transiently; any residual is swept back to the user before the transaction ends.

It is a UUPS-upgradeable proxy with an adapter registry, so new protocols are added by registering a new adapter — the core engine never changes.

## 2. Example Prompts

These natural-language prompts are decomposed by the backend into a `Step[]` array and executed here:

- "Supply 0.002 cbETH as collateral to Morpho cbETH-USDC, borrow USDC at 50% LTV, swap to cbETH, supply again — repeat 3 times"
- "Loop cbETH/USDC on Morpho at 60% LTV, 4 times, starting with 100 USDC"
- "Swap 1 USDC to PT using Pendle Market 40acresUSDC (27 Aug 2026), supply PT as collateral, borrow USDC at 80% LTV, repeat 4 times"
- "Supply cbETH and cbBTC as collateral, borrow USDC against both at 50% LTV"

Single-asset one-shot leverage ("open 2x leverage on cbETH") is routed to `MorphoLeverageExecutor` instead — this engine handles explicit multi-step and loop sequences.

## 3. Security Considered

- **Atomicity** — the whole `Step[]` runs in one transaction. If any step reverts (e.g. a borrow would breach the market LLTV), the entire strategy reverts and the user's input token is untouched. No partial position is ever created.
- **Access control** — `Ownable2Step` for the adapter registry and admin; `UUPSUpgradeable` with an `onlyOwner` upgrade authorization.
- **Reentrancy** — `nonReentrant` on `executeStrategy`; `Pausable` lets the owner halt execution.
- **Bounded work** — `MAX_STEPS = 30` caps gas exposure per strategy; `deadline` rejects stale transactions.
- **No trapped funds** — after execution the input token and every step's `tokenIn` are swept back to the user; the executor is not designed to custody balances.
- **Output verification** — for liquid-producing actions the executor checks the received balance meets the adapter's reported output (`InsufficientOutput` guard).
- **Adapter isolation** — each adapter is independently pausable and enforces its own allowlists/slippage, so a compromised route is contained.

## 4. Complete Flow

**One-time setup (per user, signed once, permanent):**
1. `inputToken.approve(executor, amount)` — lets the executor pull the input.
2. `Morpho.setAuthorization(morphoAdapter, true)` — lets the Morpho adapter act on the user's behalf (only for strategies that touch Morpho).

**The strategy transaction (one signature):**

```
User → executor.executeStrategy(inputToken, inputAmount, Step[], deadline)
  │
  ├─ pull inputAmount of inputToken from the user
  │
  ├─ for each Step i:
  │     • resolve amount:
  │         - BORROW / WITHDRAW_COLLATERAL  → output-only, no input transfer
  │         - amountFixed > 0               → use exact amount
  │         - else                          → balanceOf(executor, tokenIn) * bps / 10000
  │     • transfer input to adapters[step.adapterId] (unless output-only)
  │     • adapter.execute(action, tokenIn, amount, user, data)
  │     • verify liquid output landed in the executor
  │
  ├─ sweep inputToken + each step's tokenIn back to the user
  └─ emit StrategyExecuted(user, stepCount, gasUsed)
```

**Per-action token flow:**

| Action | Input to adapter | Adapter does | Output |
|--------|------------------|--------------|--------|
| SWAP | executor sends `tokenIn` | approve DEX, swap, enforce `minAmountOut`, reset approval | `tokenOut` back to executor |
| SUPPLY_COLLATERAL | executor sends collateral | approve Morpho, `supplyCollateral(onBehalf=user)` | none (collateral in user's Morpho position) |
| BORROW | nothing | `borrow(onBehalf=user, receiver=adapter)`, sized on-chain from target LTV | borrowed token to executor |
| REPAY | executor sends loan token | approve Morpho, `repay(onBehalf=user)` | none |
| WITHDRAW_COLLATERAL | nothing | `withdrawCollateral(onBehalf=user, receiver=executor)` | collateral to executor |

Because every step reads the executor's live balance, swap slippage and on-chain-sized borrows chain correctly without any hardcoded intermediate amounts.
