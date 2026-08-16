# N E M E S I S -- Verified Findings (Pass 3)

## Scope

- **Language:** Solidity ^0.8.20 / ^0.8.26
- **Framework:** Foundry, UUPS Proxy, OpenZeppelin v5
- **Modules analyzed:** 14 contracts (6 core + 8 adapters)
- **Functions analyzed:** 90 external/public entry points (was 82; +8 from FortSwapRouter)
- **Coupled state pairs mapped:** 7
- **Mutation paths traced:** 55
- **Nemesis loop iterations:** 6 (converged at Pass 6)
- **Pass 2 findings carried:** 10 (NM-001 through NM-010)
- **Resolved since Pass 2:** 4 (NM-002, NM-003, NM-004, NM-007)
- **New findings this pass:** 11 (NM-011 through NM-021)

---

## Key Changes Since Pass 2

1. **ReentrancyGuard upgraded:** All contracts now import `ReentrancyGuardTransient` (OZ5 transient-storage variant). Resolves NM-003.
2. **FortStrategyExecutor delta verification:** `_executeStep` replaced with full delta-based snapshot/verify loop. Resolves NM-004.
3. **MorphoStrategyAdapter._repay() excess return:** Now returns excess loan tokens to executor. Related fix.
4. **MorphoStrategyAdapter._borrow() minBorrow guard:** Uncommented. Resolves NM-002.
5. **LiFiAdapter.redeemFor residual approval:** Now cleared after swap (line 156). Resolves NM-007.
6. **LiFiAdapter.swap():** Brand new user-callable function. No vault gate. New attack surface.
7. **CrossChainRouter:** Added bridge selector whitelist (`isApprovedBridgeSelector`). Partially addresses NM-005.
8. **Storage gaps:** Changed from `[49]` to `[50]` on multiple adapters.

---

## Verification Summary

| ID | Source | Description | Severity | Verdict |
|----|--------|-------------|----------|---------|
| NM-001 | Cross-feed P1->P2 | No upgrade timelock on UUPS contracts holding Morpho authorization | HIGH | **TRUE POS** |
| NM-002 | Feynman P1 | Disabled `minBorrow` guard in MorphoStrategyAdapter | MEDIUM | **RESOLVED** |
| NM-003 | Feynman+State | Non-upgradeable ReentrancyGuard in UUPS proxy | MEDIUM | **RESOLVED** |
| NM-004 | State P2 | `_executeStep` checks total balance, not delta | MEDIUM | **RESOLVED** |
| NM-005 | Feynman P1 | Raw lifiData in depositCrossChain + naive keeper = double-spend | MEDIUM | **PARTIALLY RESOLVED** |
| NM-006 | Feynman P1 | Incomplete token sweep in executeStrategy | LOW | **TRUE POS** |
| NM-007 | Feynman P1 | LiFiAdapter.redeemFor residual approval not cleared | LOW | **RESOLVED** |
| NM-008 | Feynman P1 | FortVault deposit/rebalance residual approvals | LOW | TRUE POS |
| NM-009 | Feynman P1 | No mandatory slippage on non-ERC4626 deposits | LOW | TRUE POS |
| NM-010 | Feynman P1 | REFUND_DELAY constant declared but enforced only partially | LOW | TRUE POS |
| NM-011 | State P3 | FortVault._collectFee uses raw IERC20.transfer, not SafeERC20 | MEDIUM | **NEW - TRUE POS** |
| NM-012 | Feynman P3 | SwapStrategyAdapter: residual input tokens stuck after useFullBalance swap | MEDIUM | **NEW - TRUE POS** |
| NM-013 | Feynman P3 | User-controlled swapCalldata to whitelisted DEX can call arbitrary functions | MEDIUM | **NEW - TRUE POS** |
| NM-014 | State P3 | FortStrategyExecutor delta verification: first-seen token path uses absolute balance, not delta | LOW | **NEW - TRUE POS** |
| NM-015 | Feynman P3 | LiFiAdapter.swap(): output token == input token bypasses delta accounting | LOW | **NEW - TRUE POS** |
| NM-016 | State P3 | PendleStrategyAdapter + SwapStrategyAdapter: no residual input sweep after partial DEX consumption | LOW | **NEW - TRUE POS** |
| NM-017 | State P3 | CrossChainRouter: keeper can fulfill then user races to cancel — no state lock between initiate and fulfill | LOW | **NEW - TRUE POS** |
| NM-018 | Feynman P4 | FortSwapRouter._collectFee missing DepositFeeTaken event (unlike FortVault._collectFee) | LOW | **NEW - TRUE POS** |
| NM-019 | Feynman P4 | FortSwapRouter.swapAndDeposit: empty swapData causes Panic(0x32) instead of clean revert | LOW | **NEW - TRUE POS** |
| NM-020 | State P4 | FortSwapRouter: no validation that swapData receivingAssetId == address(usdc) | LOW | **NEW - TRUE POS** |
| NM-021 | Feynman P4 | FortSwapRouter.setApprovedDex missing zero-address check (unlike setVault) | INFO | **NEW - TRUE POS** |

---

## Resolved Findings

---

### NM-002: RESOLVED -- minBorrow Guard Uncommented

**Original:** `MorphoStrategyAdapter.sol:228-231` had the dust guard commented out.

**Resolution:** The guard is now active at `MorphoStrategyAdapter.sol:229-230`:
```solidity
if (borrowAmount < minBorrow)
    revert BorrowBelowMinimum(borrowAmount, minBorrow);
```
Verified: dust borrows on leverage loop tails are now rejected.

---

### NM-003: RESOLVED -- ReentrancyGuardTransient Adopted

**Original:** All 13 contracts imported `@openzeppelin/contracts/utils/ReentrancyGuard.sol` (non-upgradeable).

**Resolution:** All contracts now import `@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol`. This OZ5 variant uses EIP-1153 transient storage, which:
- Does not occupy a persistent storage slot (no slot-0 collision risk)
- Auto-clears at transaction end
- Is inherently compatible with UUPS proxies (no `__ReentrancyGuard_init()` needed)

Verified across all 13 contracts: `FortVault.sol:7`, `FortStrategyExecutor.sol:7`, `MorphoLeverageExecutor.sol:9`, `MorphoExitExecutor.sol:9`, `CrossChainRouter.sol:9`, `LiFiAdapter.sol:8`, `SwapStrategyAdapter.sol:9`, `MorphoStrategyAdapter.sol:9`, `PendleStrategyAdapter.sol:9`.

---

### NM-004: RESOLVED -- Delta-Based Output Verification

**Original:** `FortStrategyExecutor.sol:154-158` used total `balanceOf` to verify step output.

**Resolution:** `FortStrategyExecutor.sol:112-181` now implements full snapshot-based delta verification:
1. Snapshots `inputToken`, `steps[i].tokenIn`, and all prior `tokenOuts[j]` balances AFTER the `safeTransfer` to adapter (line 138-145)
2. After `execute()`, computes delta = `balAfter - balBefore` using the correct snapshot (lines 152-181)
3. Handles token collisions (tokenOut == inputToken, tokenOut == tokenIn, tokenOut == prior tokenOut)
4. Falls back to absolute check only for genuinely first-seen tokens (line 178)

The residual-from-previous-step bypass is eliminated. See NM-014 for a remaining edge case in the first-seen fallback path.

---

### NM-007: RESOLVED -- LiFiAdapter.redeemFor Approval Cleared

**Original:** `sourceToken` approved to `lifiDiamond` was never cleared after swap.

**Resolution:** `LiFiAdapter.sol:156`:
```solidity
IERC20(sourceToken).forceApprove(lifiDiamond, 0);
```
Approval is now zeroed after the swap completes.

---

## Carried Findings (Still Open)

---

### NM-001: No Upgrade Timelock on Contracts Holding Morpho User Authorization

**Severity:** HIGH
**Status:** STILL OPEN -- no changes to `_authorizeUpgrade` in any contract.

All UUPS contracts retain empty `_authorizeUpgrade`:
- `FortVault.sol:524`
- `FortStrategyExecutor.sol:231`
- `MorphoLeverageExecutor.sol:286`
- `MorphoExitExecutor.sol:351`
- `MorphoStrategyAdapter.sol:345`
- `CrossChainRouter.sol:332`
- `LiFiAdapter.sol:232`
- `SwapStrategyAdapter.sol:196`
- `PendleStrategyAdapter.sol:274`

```solidity
function _authorizeUpgrade(address) internal override onlyOwner {}
```

**Trigger sequence unchanged from Pass 2.** Compromised owner key = instant upgrade to malicious implementation = drain all authorized Morpho positions.

**Fix:** Deploy a TimelockController as the owner of all UUPS proxies with >= 48h delay, or implement in-contract upgrade timelock as described in Pass 2.

---

### NM-005: PARTIALLY RESOLVED -- CrossChainRouter lifiData Now Has Selector Whitelist

**Severity:** MEDIUM (downgraded from MEDIUM -- reduced blast radius)
**Status:** PARTIALLY RESOLVED

**What was fixed:** `CrossChainRouter.sol:147-149` now validates the function selector:
```solidity
bytes4 selector = bytes4(lifiData[:4]);
if (!isApprovedBridgeSelector[selector]) revert UnauthorizedSelector(selector);
```

**What remains:** The selector whitelist constrains which LiFi function can be called, but the *parameters* within that function are still fully user-controlled. A whitelisted bridge selector could be called with a destination address the user controls on the destination chain (send to attacker instead of protocol). The keeper trust model is still the primary defense. The selector whitelist significantly raises the bar but does not eliminate the keeper-bypass attack if a whitelisted bridge function permits arbitrary receiver addresses.

**Residual risk:** Low-Medium. Keeper must still verify the bridge actually deposited to the correct destination.

---

### NM-006: Incomplete Token Sweep in FortStrategyExecutor

**Severity:** LOW
**Status:** STILL OPEN

**File:** `FortStrategyExecutor.sol:184-198`

The sweep loop now covers `tokenOuts[i]` (line 186), `inputToken` (line 189), and `steps[i].tokenIn` (line 191). There is also a user-supplied `sweepTokens` array (line 196). However, tokens that appear only as a step's `tokenOut` AND are not in `sweepTokens` AND are not any step's `tokenIn` would still be missed if the adapter returned a different token than expected. The `sweepTokens` parameter is the intended mitigation but relies on the caller to know all possible output tokens.

**Risk:** Minimal with correct frontend integration. Edge case only.

---

### NM-008: FortVault Deposit/Rebalance Residual Approvals

**Severity:** LOW
**Status:** STILL OPEN

**File:** `FortVault.sol:290` (deposit now clears at line 303), `FortVault.sol:366-378` (rebalance clears at line 378).

**Update:** The `deposit` function now clears approval at line 303: `usdc.forceApprove(p.addr, 0);`. The `rebalance` function also clears at line 378. This finding is now **borderline resolved** -- keeping as LOW because some code paths (non-ERC4626 depositFor) may not consume the full approval, and the zero-approval after is the correct pattern already applied.

---

### NM-009: No Mandatory Slippage on Non-ERC4626 Deposits

**Severity:** LOW
**Status:** STILL OPEN -- no changes to deposit flow for non-ERC4626 protocols. Each adapter handles slippage internally.

---

### NM-010: REFUND_DELAY Enforced Only Partially

**Severity:** LOW
**Status:** STILL OPEN -- delay still runs from deposit timestamp, not from when request was marked Failed.

---

## New Findings (Pass 3)

---

### NM-011: FortVault._collectFee Uses Raw IERC20.transfer Instead of SafeERC20

**Severity:** MEDIUM
**Source:** State Pass 3 (token flow mutation)

**File:** `FortVault.sol:242`

```solidity
try IERC20(address(usdc)).transfer(recipient, fee) returns (bool success) {
    if (!success) pendingFees += fee;
} catch {
    pendingFees += fee;
}
```

**Issue:** This calls `IERC20.transfer()` directly instead of `usdc.safeTransfer()`. While the `try/catch` and `bool success` check provide basic error handling, there are two problems:

1. **The fee is deducted from `amount` regardless of transfer outcome** (line 249: `return amount - fee`). When the transfer fails (reverts or returns false), the fee is added to `pendingFees`, and the net amount returned is `amount - fee`. This is correct accounting IF the fee tokens remain in the vault. However, since the USDC was already pulled from the user into the vault (line 274), and the fee was never transferred out, the vault holds `amount` but only deposits `amount - fee`. The `fee` tokens sit in the vault with no tracking beyond `pendingFees`.

2. **`claimFees()` at line 253 can fail if vault USDC balance is insufficient.** If deposits and protocol operations consumed all USDC in the vault (stateless design means it should be zero after tx), then `pendingFees` accumulates a balance that does not actually exist in the vault. The vault is stateless -- USDC is forwarded to protocols within the same tx. If `_collectFee` fails to transfer the fee, the fee tokens DO remain in the vault for the current tx, but the subsequent protocol deposits operate on `netTotal = amount - fee`, leaving `fee` USDC stranded. This is correct -- `claimFees` would work. But if a subsequent `rescueToken` call sweeps those USDC, `pendingFees` becomes unbacked.

**Trigger sequence:**
1. `feeRecipient` is set to a contract that reverts on `transfer()` (e.g., a multisig with a receive guard)
2. User calls `deposit()` with 1000 USDC, `depositFeeBps = 100` (1%)
3. `_collectFee` tries `transfer(recipient, 10)` -- reverts, caught by try/catch
4. `pendingFees += 10`, `netAmount = 990`
5. 990 USDC deposited to protocols. 10 USDC remains in vault.
6. Owner calls `rescueToken(usdc, someAddr, 10)` -- the 10 USDC is swept
7. `pendingFees = 10` but vault holds 0 USDC
8. `claimFees()` reverts -- fees permanently lost

**Consequence:** Accumulated `pendingFees` can become unbacked if `rescueToken` is used carelessly. The raw `transfer` also does not handle non-standard ERC20 tokens that return no value (though USDC is standard).

**Fix:**
```solidity
function _collectFee(uint256 amount) internal returns (uint256 netAmount) {
    uint16 feeBps = depositFeeBps;
    if (feeBps == 0) return amount;
    uint256 fee = (amount * feeBps) / 10000;
    if (fee > 0) {
        address recipient = feeRecipient;
        if (recipient == address(0)) recipient = owner();
        usdc.safeTransfer(recipient, fee);
        emit DepositFeeTaken(msg.sender, fee);
    }
    return amount - fee;
}
```
Use `safeTransfer` and let the tx revert if the recipient cannot receive. Alternatively, gate `rescueToken` to exclude USDC up to `pendingFees`.

---

### NM-012: SwapStrategyAdapter Residual Input Tokens Stuck After useFullBalance Swap

**Severity:** MEDIUM
**Source:** Feynman Pass 3 (token flow: "where do unconsumed input tokens go?")

**File:** `SwapStrategyAdapter.sol:136-171`

```solidity
if (useFullBalance) {
    amountIn = IERC20(token).balanceOf(address(this));  // line 141
    if (amountIn == 0) revert ZeroBalance();
} else {
    amountIn = amount;
}

IERC20(token).forceApprove(dex, amountIn);              // line 152

(bool success, ) = dex.call(swapCalldata);               // line 160
if (!success) revert SwapFailed();

// ... output check ...

IERC20(token).forceApprove(dex, 0);                      // line 168

out.safeTransfer(executor, received);                     // line 171
// NO sweep of residual input token
```

**Issue:** In `useFullBalance` mode, the adapter approves its entire balance of `token` to the DEX and calls `swapCalldata`. Many DEX aggregators (Odos, 1inch, Paraswap) may not consume the full approved amount if the calldata specifies a smaller `fromAmount` than the adapter's actual balance. The approval is cleared (line 168), but **residual input tokens remain in the adapter**.

In `EXACT` mode, the executor sends exactly `amount` via `safeTransfer`, so the executor has no residual. But in `useFullBalance` mode, the adapter reads its own balance which may exceed what the DEX consumes.

**Trigger sequence:**
1. Strategy step 1: BORROW 1000 USDT, sent to executor
2. Strategy step 2: SWAP via SwapStrategyAdapter with `useFullBalance=true`
3. Executor sends 1000 USDT to adapter. Adapter reads balance = 1000.
4. `swapCalldata` was built for an estimated 950 USDT. DEX only pulls 950.
5. Adapter sends output tokens to executor. 50 USDT remains in adapter.
6. No sweep of residual input in the adapter code.
7. The 50 USDT is stuck until `rescueToken` is called by owner.

**Consequence:** User loses residual input tokens that stay in the adapter. Subsequent users' `useFullBalance` swaps would consume them (first-come-first-served on stranded tokens). This is a fund-mixing risk.

**Verification:** `SwapStrategyAdapter.execute()` only calls `out.safeTransfer(executor, received)` at line 171. There is no `IERC20(token).safeTransfer(executor, residual)` equivalent. Compare with `LiFiAdapter.swap()` which DOES sweep residual input at line 217-218.

**Fix:**
```solidity
// After line 171, add:
uint256 residualInput = IERC20(token).balanceOf(address(this));
if (residualInput > 0) {
    IERC20(token).safeTransfer(executor, residualInput);
}
```

---

### NM-013: User-Controlled swapCalldata to Whitelisted DEX Can Invoke Arbitrary Functions

**Severity:** MEDIUM
**Source:** Feynman Pass 3 (Category 4: "what CAN the user do with this calldata?")

**Affected files:**
- `MorphoLeverageExecutor.sol:254` -- `dex.call(swapCalldata)`
- `MorphoExitExecutor.sol:303` -- `dex.call(swapCalldata)`
- `SwapStrategyAdapter.sol:160` -- `dex.call(swapCalldata)`

```solidity
(bool success, ) = dex.call(swapCalldata);
```

**Issue:** The `swapCalldata` is entirely user-controlled. The only validation is that `dex` is in `isApprovedDex`. There is no function selector whitelist on the DEX call itself (unlike `CrossChainRouter` which now validates selectors, and `PendleStrategyAdapter` which validates router selectors).

A whitelisted DEX contract (e.g., 1inch AggregationRouter, Odos Router) exposes many functions beyond just swapping. An attacker could craft `swapCalldata` that calls a non-swap function on the DEX, such as:
- `transferFrom` if the DEX has token approvals from other users
- Administrative functions if the DEX has them
- `multicall` to batch arbitrary sub-calls
- Callback functions that re-enter into other Fortress contracts

The `forceApprove(dex, amountIn)` before the call gives the DEX approval to pull `amountIn` of `tokenIn`. If the user crafts calldata that does NOT consume this approval for a swap but instead calls another function, the approved tokens could be misrouted.

**Concrete scenario with 1inch:**
1. User calls `openLeverage` with `dex = 1inchRouter` (whitelisted) and `swapCalldata = abi.encodeWithSelector(1inch.unoswapTo(...))` targeting a pool that sends tokens to the attacker instead of back to the executor.
2. The `minCollateralOut` check catches this IF collateral does not arrive. But if the attacker crafts a call that sends *some* collateral back (above `minCollateralOut`) while siphoning the rest, the check passes.

**Mitigation already in place:** The `minCollateralOut` / `minAmountOut` / `minLoanOut` checks after the call are the primary defense. The token balance delta check ensures the contract received at least `minOut`. This limits the damage to the slippage tolerance.

**Residual risk:** The attacker cannot steal more than `(actualFairValue - minOut)` tokens. With tight slippage settings, exposure is small. But with loose slippage (e.g., `minOut = 0` which is blocked in MorphoLeverageExecutor but not explicitly in all paths), the entire swap amount could be misdirected.

**Fix:** Add function selector whitelists to DEX calls, similar to `PendleStrategyAdapter.isApprovedRouterSelector`:
```solidity
mapping(bytes4 => bool) public isApprovedSwapSelector;

// In _swap:
bytes4 selector = bytes4(swapCalldata);
if (!isApprovedSwapSelector[selector]) revert UnauthorizedSelector(selector);
```

---

### NM-014: FortStrategyExecutor Delta Verification -- First-Seen Token Uses Absolute Balance

**Severity:** LOW
**Source:** State Pass 3 (delta verification edge case analysis)

**File:** `FortStrategyExecutor.sol:176-180`

```solidity
} else {
    // First-seen token: use post-transfer snapshot as baseline
    if (balAfter < amountOut)
        revert InsufficientOutput(amountOut, balAfter);
}
```

**Issue:** When `tokenOut` is not `inputToken`, not `steps[i].tokenIn`, and not any prior `tokenOuts[j]`, the code falls through to an absolute balance check (`balAfter < amountOut`). This is the "first-seen token" path.

The snapshot is taken AFTER the `safeTransfer` to the adapter (line 138-145), so pre-existing balances of the first-seen token at the executor ARE included in `balAfter`. If the executor already holds some of this token (e.g., from a previous unrelated transaction's dust, or from a `rescueToken` deposit), the adapter could return less than `amountOut` and the check would still pass because the pre-existing balance fills the gap.

**Trigger sequence:**
1. Someone accidentally sends 100 TOKEN_X to the executor contract
2. User executes a strategy where step 3 outputs TOKEN_X (first time seen in this strategy)
3. Adapter claims it output 150 TOKEN_X (`amountOut = 150`) but actually only sent 50
4. `balAfter = 50 + 100(pre-existing) = 150 >= 150` -- check passes
5. Sweep sends all 150 to user, but 100 was not earned by this strategy

**Consequence:** Defense-in-depth gap. A malicious adapter (if registered) could claim inflated output. With trusted adapters, this is a dust/accounting edge case only. The pre-existing balance scenario requires tokens to be stranded in the executor, which should not happen in normal operation.

**Fix:** Snapshot the first-seen token balance before execution begins (at strategy entry), not just after the transfer to adapter.

---

### NM-015: LiFiAdapter.swap() -- Output Token == Input Token Bypasses Intended Flow

**Severity:** LOW
**Source:** Feynman Pass 3 (parameter validation: "what if outputToken == inputToken?")

**File:** `LiFiAdapter.sol:170-221`

```solidity
function swap(
    address inputToken,
    uint256 inputAmount,
    address outputToken,        // no check that outputToken != inputToken
    uint256 minOutputAmount,
    uint256 deadline,
    LibSwap.SwapData[] calldata swapData
) external nonReentrant {
```

**Issue:** There is no validation that `outputToken != inputToken`. If a user sets them to the same token:

1. `balBefore = IERC20(outputToken).balanceOf(address(this))` (line 196) -- this is 0 before the pull
2. `IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount)` (line 192)
3. Now `IERC20(outputToken).balanceOf(address(this)) >= inputAmount` (since outputToken == inputToken)
4. The LiFi swap may consume some or all, but the delta `received = balAfter - balBefore` includes the input amount that was pulled

The `balBefore` is measured at line 196 AFTER the `safeTransferFrom` at line 192. Wait -- actually the order is: pull (192), approve (193), measure balBefore (196), swap (198), measure received (207). So `balBefore` IS measured after the pull, meaning the pulled input IS included in `balBefore`. The delta would be correct.

However, line 214: `IERC20(outputToken).safeTransfer(msg.sender, received)` sends `received` output tokens. Then line 217-218 sweeps residual input: `IERC20(inputToken).safeTransfer(msg.sender, residual)`. When `outputToken == inputToken`, `received` already captured the delta, and `residual` would be `inputAmount - (consumed by swap) - received`. This could double-count or create confusing accounting.

**Concrete issue:** If the LiFi swap does nothing (reverts are caught by the swap itself, but consider a no-op swap that returns the tokens), then `received = 0` and the `minOutputAmount` check fails. So this path is not directly exploitable but creates a confusing UX footgun.

**Fix:** Add `if (inputToken == outputToken) revert SameToken();`

---

### NM-016: PendleStrategyAdapter and SwapStrategyAdapter Have No Residual Input Sweep

**Severity:** LOW
**Source:** State Pass 3 (adapter token flow completeness)

**Affected files:**
- `SwapStrategyAdapter.sol:108-183` -- only sends `out.safeTransfer(executor, received)`, no input sweep
- `PendleStrategyAdapter.sol:157-217` -- `_routerRelay` only sends `IERC20(outToken).safeTransfer(executor, received)`, no input sweep

**Issue:** Both adapters send only the output tokens back to the executor. If the DEX/Router does not consume the full input (e.g., partial fill, rounding), the unconsumed input tokens remain stranded in the adapter contract. The approval is zeroed so they are safe from external theft, but they are inaccessible to the user without owner intervention via `rescueToken`.

Compare with `LiFiAdapter.swap()` which sweeps residual input at lines 217-218.

**Consequence:** Dust loss on partial fills. Requires `rescueToken` to recover. Minor fund-mixing risk if another user's strategy triggers a `useFullBalance` swap on the same adapter that picks up the stranded tokens.

**Fix:** After the output transfer, sweep residual input back to the executor:
```solidity
uint256 residual = IERC20(token).balanceOf(address(this));
if (residual > 0) IERC20(token).safeTransfer(executor, residual);
```

---

### NM-017: CrossChainRouter -- No State Lock Between Withdraw Initiate and Fulfill

**Severity:** LOW
**Source:** State Pass 3 (lifecycle state machine analysis)

**File:** `CrossChainRouter.sol:224-297`

**Issue:** The withdraw lifecycle is: `initiateWithdraw` (user) -> `fulfillWithdraw` (keeper) -> `claimWithdraw` (user). There is also `cancelWithdraw` (user). The state machine is:

```
Pending --[fulfillWithdraw]--> Completed --[claimWithdraw]--> Claimed
Pending --[cancelWithdraw]--> Cancelled
```

The potential race: user calls `cancelWithdraw` in the same block that keeper calls `fulfillWithdraw`. Both check `status == Pending`. Depending on tx ordering:

- If `cancelWithdraw` executes first: status becomes `Cancelled`, `fulfillWithdraw` reverts with `InvalidRequestStatus`. Correct.
- If `fulfillWithdraw` executes first: status becomes `Completed`, `pendingWithdrawBalance += actualAmount`, `cancelWithdraw` reverts with `InvalidRequestStatus`. Correct BUT the keeper has now committed USDC that the user may not want.

This is not a bug per se -- the keeper's `fulfillWithdraw` is the point of no return. But the keeper has no way to know the user submitted a cancel in the mempool. The keeper's USDC is now locked in `pendingWithdrawBalance` until the user calls `claimWithdraw`. If the user refuses to claim (they wanted to cancel), the USDC is permanently locked.

**Trigger sequence:**
1. User calls `initiateWithdraw(1000 USDC, ...)`
2. Keeper sends USDC to router and calls `fulfillWithdraw(requestId, 1000)`
3. User's `cancelWithdraw` tx is in the same block but ordered after -- reverts
4. User decides not to claim (they changed their mind)
5. `pendingWithdrawBalance = 1000` permanently. That 1000 USDC is excluded from `rescueToken` and all future `fulfillWithdraw` balance checks.

**Consequence:** Keeper's USDC permanently locked. No admin function to force-claim or revert a fulfilled-but-unclaimed withdrawal.

**Fix:** Add an admin function to expire unclaimed withdrawals after a timeout:
```solidity
function expireUnclaimedWithdraw(bytes32 requestId) external onlyOwner {
    WithdrawRequest storage req = _withdrawRequests[requestId];
    if (req.status != RequestStatus.Completed) revert InvalidRequestStatus();
    if (block.timestamp < req.timestamp + 30 days) revert TooEarly();
    pendingWithdrawBalance -= req.actualAmount;
    req.status = RequestStatus.Cancelled;
}
```

---

### NM-018: FortSwapRouter._collectFee Missing DepositFeeTaken Event

**Severity:** LOW
**Source:** Feynman Pass 4 (consistency: "WHY does FortVault._collectFee emit DepositFeeTaken but FortSwapRouter._collectFee does not?")

**File:** `FortSwapRouter.sol:181-192`

```solidity
function _collectFee(uint256 amount) internal returns (uint256 netAmount) {
    IFortVault v = IFortVault(vault);
    uint16 feeBps = v.depositFeeBps();
    if (feeBps == 0) return amount;
    uint256 fee = (amount * feeBps) / 10000;
    if (fee > 0) {
        address recipient = v.feeRecipient();
        if (recipient == address(0)) recipient = v.owner();
        usdc.safeTransfer(recipient, fee);
        // NO event emitted here
    }
    return amount - fee;
}
```

**Comparison:** `FortVault.sol:224` emits `emit DepositFeeTaken(msg.sender, fee)` after the fee transfer.

**Issue:** Fee collection through FortSwapRouter is invisible to off-chain indexers. Dashboards tracking protocol revenue via `DepositFeeTaken` events will undercount fees collected from swap-and-deposit flows.

**Consequence:** No on-chain impact. Off-chain analytics gap. Auditors and governance cannot track fees collected through the router without parsing raw transfer logs.

**Fix:**
```solidity
if (fee > 0) {
    address recipient = v.feeRecipient();
    if (recipient == address(0)) recipient = v.owner();
    usdc.safeTransfer(recipient, fee);
    emit DepositFeeTaken(msg.sender, fee);  // add event
}
```

---

### NM-019: Empty swapData Causes Panic Instead of Clean Revert

**Severity:** LOW
**Source:** Feynman Pass 4 (boundary: "what if swapData.length == 0?")

**File:** `FortSwapRouter.sol:136-142`

```solidity
LibSwap.SwapData[] memory _swaps = new LibSwap.SwapData[](swapData.length); // length=0
for (uint256 i; i < swapData.length; i++) {  // loop skipped
    _swaps[i] = swapData[i];
    ...
}
_swaps[0].fromAmount = inputAmount;  // Panic(0x32) — out-of-bounds on empty array
```

**Issue:** If `swapData` is empty, `_swaps` is a zero-length array, and `_swaps[0]` panics with `Panic(0x32)` (array out-of-bounds). No explicit validation exists for `swapData.length > 0`.

**Consequence:** Reverts correctly (caller cannot proceed), but returns opaque `Panic(0x32)` instead of a meaningful error. Frontends and error-tracking systems cannot distinguish this from other array-bounds bugs.

**Fix:**
```solidity
if (swapData.length == 0) revert ZeroAmount();
```
Add before line 136.

---

### NM-020: No Validation That swapData receivingAssetId == address(usdc)

**Severity:** LOW
**Source:** State Pass 4 (coupled state: "swapData.receivingAssetId and usdc immutable should match")

**File:** `FortSwapRouter.sol:136-142`

**Issue:** The router validates `callTo` (approved DEX) and `approveTo` (must be lifiDiamond), but does not validate that `receivingAssetId == address(usdc)`. A misconfigured frontend could submit swap data targeting a different output token. LiFi would swap to that token instead of USDC, and the router's `usdc.balanceOf(address(this))` delta check (line 160) would show 0, causing the slippage revert.

**Consequence:** Not exploitable — reverts via slippage check. But the revert error `SlippageExceeded(0, minUsdcOut)` is misleading: the real issue is wrong output token, not insufficient swap output.

**Fix:**
```solidity
if (_swaps[0].receivingAssetId != address(usdc)) revert InvalidReceivingAsset();
```

---

### NM-021: setApprovedDex Missing Zero-Address Check

**Severity:** Informational
**Source:** Feynman Pass 4 (consistency: "setVault checks zero address, setApprovedDex does not")

**File:** `FortSwapRouter.sol:86-89`

```solidity
function setApprovedDex(address dex, bool approved) external onlyOwner {
    isApprovedDex[dex] = approved;  // dex can be address(0)
    emit DexApprovalUpdated(dex, approved);
}
```

**Issue:** Owner can call `setApprovedDex(address(0), true)`. This sets `isApprovedDex[address(0)] = true`, which would pass the `callTo` validation check for any swap entry where `callTo` is uninitialized (default `address(0)` in memory). In practice this requires a very specific misconfiguration chain and is owner-only, so it is informational.

**Fix:**
```solidity
function setApprovedDex(address dex, bool approved) external onlyOwner {
    if (dex == address(0)) revert ZeroAddress();
    isApprovedDex[dex] = approved;
    emit DexApprovalUpdated(dex, approved);
}
```

---

## False Positives Eliminated

| Candidate | Reason |
|-----------|--------|
| CrossChainRouter balance drain via lifiData | USDC approval capped at `usdcAmount`; raw call runs in LiFi context, no delegatecall; reentrancy guard blocks callbacks; balance delta check strict. **Updated:** selector whitelist adds additional defense. |
| FortVault withdraw reentrancy | `nonReentrant` (transient) + USDC has no transfer hooks |
| Request ID collision | `keccak256(sender, nonce++, chainid)` -- all fixed-size, nonce auto-increments |
| MorphoLeverageExecutor flash callback hijack | `msg.sender == morpho` + transient storage commitment. Can't set commitment without `openLeverage` (has `nonReentrant`). **Verified again Pass 3:** commitment uses unique slot `FORT_LEV_FLASH` vs `FORT_EXIT_FLASH` -- no cross-contract collision. |
| MorphoExitExecutor cross-contract re-entrancy with MorphoLeverageExecutor | Different transient storage slots (`0x464f52545f4c45565f464c415348` vs `0x464f52545f455849545f464c415348`). Each contract's `nonReentrant` is independent (transient, per-contract). Callback checks `msg.sender == morpho`. No cross-contract exploit path. |
| Fee rounding exploitable | `fee = amount * feeBps / 10000` with `feeBps <= 500`. Sub-cent loss on < $0.01 deposits only |
| CompoundV3Adapter.redeemFor wrong usdcOut | Comet rebasing balances denominated in underlying. `usdcOut = shares` correct for Comet model |
| LiFiAdapter.swap re-entrancy | `nonReentrant` (transient) blocks callback-driven re-entry. DEX whitelist prevents calling arbitrary contracts. Token transfers use SafeERC20. |
| LiFiAdapter.swap token approval leak | Approval is set to `inputAmount` before swap, then cleared to 0 after swap (line 211). No leak window outside the atomic swap call. |
| Delta verification bypass via duplicate tokenOut across steps | The snapshot loop (lines 164-170) finds the FIRST matching prior `tokenOuts[j]` and uses its snapshot. If two prior steps output the same token, only the first snapshot is used. However, since the snapshot is re-taken per step (line 140-145), and the `prevOutSnaps` array captures the balance at step `i`'s snapshot time (after transfer to adapter `i`), the delta is computed against the correct point-in-time balance. Not exploitable. |

---

## Summary

```
Final: 0 CRITICAL | 1 HIGH | 4 MEDIUM | 8 LOW | 1 INFO

Resolved since Pass 2: 4 findings (NM-002, NM-003, NM-004, NM-007)
Partially resolved: 1 finding (NM-005)
New findings: 11 (NM-011 through NM-021)

Highest priority:
  NM-001 (HIGH) -- Add upgrade timelock to all UUPS contracts, especially
                    those requiring user Morpho authorization. UNCHANGED.
  NM-011 (MED)  -- Use SafeERC20 for fee transfer; protect pendingFees from rescueToken
  NM-012 (MED)  -- Add residual input sweep to SwapStrategyAdapter
  NM-013 (MED)  -- Add function selector whitelists to raw dex.call() in executors
  NM-005 (MED)  -- CrossChainRouter lifiData parameter control (partially fixed)

FortSwapRouter-specific (all LOW/INFO — contract is well-designed):
  NM-018 (LOW)  -- Add DepositFeeTaken event to _collectFee
  NM-019 (LOW)  -- Validate swapData.length > 0 before array access
  NM-020 (LOW)  -- Validate receivingAssetId == usdc for defense-in-depth
  NM-021 (INFO) -- Add zero-address check to setApprovedDex
```

### Architecture Assessment (Updated)

- **Transient reentrancy guard adoption is excellent.** The move to `ReentrancyGuardTransient` eliminates the storage-layout concern from NM-003 and provides cleaner semantics for UUPS proxies.
- **Delta-based verification in FortStrategyExecutor is a significant improvement.** The snapshot-before/check-after pattern correctly handles token collisions in most cases. The first-seen fallback (NM-014) is a minor edge case.
- **LiFiAdapter.swap() is well-implemented** with proper approval hygiene, deadline, DEX whitelist, slippage check, and residual input sweep. It is the most complete adapter in terms of token flow safety.
- **CrossChainRouter bridge selector whitelist** significantly reduces the attack surface from NM-005. The residual risk is in parameter-level validation within bridge calls.
- **The DEX calldata control issue (NM-013)** is the most architecturally significant new finding. Adding selector whitelists to DEX calls (as was done for CrossChainRouter and PendleStrategyAdapter) would bring consistency across the codebase.
- **Adapter residual input sweep inconsistency (NM-012, NM-016)** should be standardized. `LiFiAdapter.swap()` does it right; the pattern should be copied to `SwapStrategyAdapter` and `PendleStrategyAdapter`.
- **FortSwapRouter is well-designed.** Near-stateless architecture (only `isApprovedDex` and `vault` in storage), proper ReentrancyGuardTransient, SafeERC20 throughout, residual input sweep (line 167-168), approval cleanup after deposits (line 223), and correct remainder-to-last BPS arithmetic. 4 LOW/INFO findings are all defense-in-depth hardening, not exploitable bugs.
- **NM-001 remains the highest priority item.** All other findings are defense-in-depth improvements. NM-001 is the only finding that could result in total fund loss from a single compromised key.

---

## Nemesis Map

```
                            NM-001 [HIGH]
                     Upgrade Timelock Gap
                    /        |         \
                   /         |          \
         MorphoLevExec  MorphoExitExec  MorphoStratAdapter
         (auth trust)   (auth trust)    (auth trust)
                   \         |          /
                    \        |         /
                     NM-013 [MED]
               Raw dex.call(user calldata)
                    /        |
                   /         |
          SwapStratAdapter   |
          (no input sweep)   |
               |             |
            NM-012 [MED]     |
         Stuck residual      |
               |             |
            NM-016 [LOW]     |
         PendleStrat too     |
                             |
                      FortStratExecutor
                      (delta verify)
                             |
                          NM-014 [LOW]
                     First-seen fallback
                             |
                          NM-006 [LOW]
                     Incomplete sweep

    FortVault -----> NM-011 [MED]
    (_collectFee)    Raw transfer + pendingFees desync

    CrossChainRouter --> NM-005 [MED-partial]
    (selector whitelist)    |
                         NM-017 [LOW]
                    Fulfill/cancel race

    LiFiAdapter.swap() --> NM-015 [LOW]
    (inputToken==outputToken)

    FortSwapRouter -----> NM-018 [LOW]
    (_collectFee)         Missing event
                    |
                    +---> NM-019 [LOW]
                          Empty swapData panic
                    |
                    +---> NM-020 [LOW]
                          No receivingAssetId check
                    |
                    +---> NM-021 [INFO]
                          setApprovedDex no zero-check
```
