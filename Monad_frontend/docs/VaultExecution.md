# Vault Prompt Execution

## 1. Summary

The vault pipeline handles yield operations against `FortVault`: depositing USDC across registered protocols (Morpho, Aave), withdrawing shares back to USDC, and rebalancing between protocols. These are the "earn" primitives — no leverage, no debt. Deposit and swap-and-deposit intents also carry a live blended deposit APY preview.

Two paths reach the vault:
- **Prompt path** — `POST /fortress/plan` → `CalldataBuilder.build()` for `deposit` / `withdraw` / `rebalance` / `claimWithdraw` / `cancelWithdraw`.
- **Direct path** — `POST /fortress/withdraw` → `WithdrawService`, a token-address-based withdraw used by the UI's Withdraw panel.

## 2. Example Prompts

- "Deposit 500 USDC to Morpho"
- "Deposit 1000 USDC split 60% Morpho 40% Aave"
- "Lend 200 USDC to Aave"
- "Withdraw all from Morpho"
- "Withdraw 200 USDC from Aave"
- "Withdraw 50% from Morpho"
- "Move all my Aave position to Morpho" (rebalance)
- "Claim withdrawal 0x…" / "Cancel my pending withdrawal 0x…"

Note: only USDC can be deposited directly. Any other token routes through swap-and-deposit — see [SwapAndBridgeExecution](./SwapAndBridgeExecution.md).

## 3. Security & Validation

- **Allocation integrity** — deposit allocations are basis points that must sum to 10000; the last leg absorbs any rounding remainder so the full amount is always deployed.
- **On-chain-derived minimums** — deposit share floors come from a live `previewDeposit`; withdraw/rebalance USDC floors come from `previewRedeem` — both minus a 0.5% slippage tolerance (`SLIPPAGE_BPS = 9950`). No hardcoded expectations.
- **Protocol allowlist** — protocol names resolve against the on-chain registry (`keccak256(name)` keys); an unknown protocol reverts the build with the available list.
- **Share custody model** — the vault pulls shares via `redeem(owner=user)`, so the user approves the vault on each ERC-4626 share token; approvals are scoped to the exact shares.
- **Amount-type discipline** — withdraw interprets the amount by `amountType` (`usdc` → `convertToShares`, `percent` → 1–100 of balance, `all` → full balance, `shares` → raw units), each validated (e.g. percent must be 1–100, balance must be non-zero).
- **Tenderly pre-flight** — every path simulates before returning.

## 4. Complete Flow

**Deposit** (`CalldataBuilder.buildDeposit`):
```
split total by allocation bps (last leg absorbs remainder)
for each leg: minSharesOut = previewDeposit(legAmount) × 0.995
txs = [ approve(USDC, vault, total), vault.deposit(entries[]) ]
```

**Withdraw** (`CalldataBuilder.buildWithdraw`):
```
resolve shares per entry by amountType (usdc→convertToShares, percent→% of balance, all→full, shares→raw)
for each leg: minUsdcOut = previewRedeem(shares) × 0.995
txs = [ shareApprove(vault) per ERC-4626 leg…, vault.withdraw(entries[]) ]
```

**Rebalance** (`CalldataBuilder.buildRebalance`):
```
for each entry: minUsdcOut = previewRedeem(from, shares) × 0.995
                minSharesOut = previewDeposit(to, minUsdcOut) × 0.995   // sized off the redeem floor
txs = [ shareApprove(vault) per source leg…, vault.rebalance(entries[]) ]
```

**Cross-chain claim/cancel** (`buildRequestCall`): a single `crossChainRouter.claimWithdraw(requestId)` or `cancelWithdraw(requestId)`.

**Direct withdraw endpoint** (`POST /fortress/withdraw`, `WithdrawService`): takes `{ walletAddress, tokenAddress, amount, amountType }`, resolves the protocol from the token address, builds the same withdraw shape, simulates, and returns `{ description, protocol, shares, minUsdcOut, transactions, simulation }`.

Deposit APY preview (`computeDepositApy`) is attached to `deposit`/`swapAndDeposit` responses — see Calculations below and [ApyService](./ApyService.md).

## 5. Calculations

**Deposit split** (bps of total, remainder to last leg):
```
legAmount_i = total × bps_i / 10000
last leg    += total − Σ legAmount_i        // absorb rounding dust
```

**Slippage-protected minimums** (`SLIPPAGE_BPS = 9950` → 0.5%):
```
minSharesOut = previewDeposit(assets) × 9950 / 10000
minUsdcOut   = previewRedeem(shares) × 9950 / 10000
```

**Withdraw amount resolution:**
```
usdc     → shares = convertToShares(amount), capped to balance
percent  → shares = balance × round(pct × 100) / 10000     // pct ∈ [1,100]
all      → shares = full balance
shares   → shares = amount (raw)
```

**Blended deposit APY** (`computeDepositApy`, bps-weighted, withheld if any leg unavailable):
```
netApy = Σ (legApy_i × bps_i) / 10000       // only when every leg resolves "ok"
```
Per-protocol source: Morpho MetaMorpho `netApy` via the Morpho API; Aave via the on-chain pool liquidity rate (ray → APY). See [Calculations](./Calculations.md#deposit-apy).
