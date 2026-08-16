# FORTRESS Protocol -- Developer Handoff

> Nemesis Audit Findings (9 TRUE POSITIVES) + Missing Test Cases (~110 tests)
>
> Date: 2026-07-03 | Auditor: Nemesis (Feynman + State Inconsistency Loop)
>
> Current test suite: **196 tests, all passing**

---

## TABLE OF CONTENTS

1. [Audit Findings & Fixes (9 findings)](#part-1-audit-findings--required-fixes)
2. [Missing Test Cases by Contract](#part-2-missing-test-cases)
   - [FortVault (~25 tests)](#1-fortvault)
   - [FortStrategyExecutor (~20 tests)](#2-fortstrategyexecutor)
   - [CrossChainRouter (~15 tests)](#3-crosschainrouter)
   - [LiFiAdapter (~8 tests)](#4-lifiadapter)
   - [MorphoStrategyAdapter (~10 tests)](#5-morphostrategyadapter)
   - [SwapStrategyAdapter (~8 tests)](#6-swapstrategyadapter)
   - [Cross-System / Reentrancy (~6 tests)](#7-cross-system--reentrancy)

---

# PART 1: AUDIT FINDINGS & REQUIRED FIXES

## NM-001 [MEDIUM]: Non-Upgradeable ReentrancyGuard in UUPS Proxy

**Files:** `src/FortVault.sol:7`, `src/FortStrategyExecutor.sol:7`

**Problem:** Both UUPS proxy contracts import `ReentrancyGuard` (non-upgradeable) instead of `ReentrancyGuardUpgradeable`. The proxy's `_status` storage slot is never initialized (stays 0). Works by accident because `0 != ENTERED(2)`. Creates storage layout hazard: `_status` sits at slot 0, pushing all contract state down by one slot. Any future upgrade that changes inheritance order or switches to `ReentrancyGuardUpgradeable` (ERC-7201 namespaced storage) will cause storage collision.

**Fix:**

```solidity
// BEFORE (both contracts):
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// AFTER:
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

// In inheritance:
contract FortVault is
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable  // changed
{
    function initialize(address _usdc) external initializer {
        __Ownable_init(msg.sender);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();  // add this
        usdc = IERC20(_usdc);
    }
}
```

**WARNING:** Already-deployed proxies need storage migration. Slot 0 currently holds `_status`. After fix, `ReentrancyGuardUpgradeable` uses namespaced storage and slot 0 is freed, shifting all state variables. Deploy fresh proxy or write explicit migration in upgrade function.

---

## NM-002 [MEDIUM]: Incomplete Token Sweep in executeStrategy()

**File:** `src/FortStrategyExecutor.sol:113-119`

**Problem:** Sweep only covers `inputToken` + `steps[*].tokenIn`. Output tokens from BORROW/WITHDRAW_COLLATERAL steps are NOT swept if they don't match any `tokenIn` or `inputToken`. Borrowed/withdrawn tokens stuck in executor.

**Example:** Supply WETH collateral -> Borrow USDT. USDT never swept because no step has `tokenIn=USDT`.

**Fix (Option A -- explicit sweep list):**

```solidity
function executeStrategy(
    address inputToken,
    uint256 inputAmount,
    Step[] calldata steps,
    address[] calldata sweepTokens,  // NEW: user lists all tokens to sweep
    uint256 deadline
) external whenNotPaused nonReentrant {
    // ... existing logic ...

    // Sweep all user-specified tokens
    for (uint256 i; i < sweepTokens.length; i++) {
        _sweepToken(sweepTokens[i], msg.sender);
    }
}
```

**Fix (Option B -- track outputs during execution):**

```solidity
// In executeStrategy, after the step loop:
address[] memory outputTokens = new address[](steps.length);
for (uint256 i; i < steps.length; i++) {
    (address tokenOut,) = _executeStep(steps[i], msg.sender);
    outputTokens[i] = tokenOut;
}

// Sweep inputToken + all tokenIns + all tokenOuts
_sweepToken(inputToken, msg.sender);
for (uint256 i; i < steps.length; i++) {
    if (steps[i].tokenIn != inputToken) _sweepToken(steps[i].tokenIn, msg.sender);
    if (outputTokens[i] != address(0) && outputTokens[i] != inputToken) {
        _sweepToken(outputTokens[i], msg.sender);
    }
}
```

---

## NM-003 [MEDIUM]: Raw lifiData Enables Non-Bridge USDC Consumption

**File:** `src/CrossChainRouter.sol:137`

**Problem:** `depositCrossChain()` forwards user-controlled `lifiData` to `lifiDiamond.call()`. Balance check verifies USDC was consumed but NOT that it was bridged. User can craft `lifiData` to call a swap function instead of bridge. If automated keeper naively refunds "failed" deposit, user gets double value (swap output + refund).

**Fix -- validate function selector:**

```solidity
// Add at top of contract:
bytes4 private constant BRIDGE_GENERIC = 0x...; // startBridgeTokensViaGenericBridge selector
bytes4 private constant BRIDGE_STARGATE = 0x...; // startBridgeTokensViaStargate selector
// ... add all valid bridge selectors

// In depositCrossChain(), before the lifiDiamond.call:
bytes4 selector = bytes4(lifiData[:4]);
if (
    selector != BRIDGE_GENERIC &&
    selector != BRIDGE_STARGATE
    // ... other allowed selectors
) revert OnlyBridgeCallsAllowed();

(bool success,) = lifiDiamond.call(lifiData);
```

---

## NM-004 [LOW]: REFUND_DELAY Declared But Never Enforced

**File:** `src/CrossChainRouter.sol:27`

**Problem:** `uint256 public constant REFUND_DELAY = 24 hours;` exists but `refundDeposit()` never checks it. Compromised keeper can instantly cycle mark-failed + refund.

**Fix:**

```solidity
function refundDeposit(bytes32 requestId) external onlyKeeper {
    DepositRequest storage req = _depositRequests[requestId];
    if (req.user == address(0)) revert RequestNotFound();
    if (req.status != RequestStatus.Failed) revert InvalidRequestStatus();

    // ADD: enforce delay
    if (block.timestamp < req.timestamp + REFUND_DELAY) revert TooEarly();

    // ... rest unchanged
}
```

Add error: `error TooEarly();`

---

## NM-005 [LOW]: _executeStep Checks Total Balance Not Delta

**File:** `src/FortStrategyExecutor.sol:154-158`

**Problem:** Output verification uses `IERC20(tokenOut).balanceOf(address(this))` (total balance) instead of before/after delta. If executor already holds `tokenOut` from previous step, check passes even if current adapter sent nothing.

**Fix:** Track balance delta. Requires interface change since `tokenOut` is unknown before the call. Add `expectedTokenOut` to Step struct, or accept as design tradeoff since adapters are owner-whitelisted.

---

## NM-006 [LOW]: LiFiAdapter.redeemFor Residual Approval Not Cleared

**File:** `src/adapters/LiFiAdapter.sol:84-119`

**Problem:** After swap, `sourceToken` approval to `lifiDiamond` is not cleared. Compare with MorphoStrategyAdapter which clears approval after every operation.

**Fix -- add after line 117:**

```solidity
usdcOut = usdc.balanceOf(address(this)) - balBefore;
usdc.safeTransfer(receiver, usdcOut);

// ADD: clear residual approval
IERC20(sourceToken).forceApprove(lifiDiamond, 0);
```

---

## NM-007 [LOW]: FortVault.rebalance Has No Slippage Protection

**File:** `src/FortVault.sol:253-303`

**Problem:** `rebalance()` has no `minUsdcOut`, no `deadline`, no residual sweep. Compare with `swapAndDeposit()` which has all three. Vulnerable to sandwich attacks during redeem phase.

**Fix:**

```solidity
function rebalance(
    RebalanceEntry[] calldata entries,
    uint256[] calldata minUsdcOuts,
    uint256 deadline
) external whenNotPaused nonReentrant {
    if (block.timestamp > deadline) revert DeadlineExpired();

    for (uint256 i; i < entries.length; i++) {
        // ... existing redeem logic ...

        if (usdcOut < minUsdcOuts[i])
            revert SlippageExceeded(usdcOut, minUsdcOuts[i]);

        // ... existing deposit logic ...
    }
    emit Rebalanced(msg.sender, entries.length);
}
```

---

## NM-008 [LOW]: Residual Approvals After Deposit/Rebalance

**Files:** `src/FortVault.sol:189` (deposit), `src/FortVault.sol:288` (rebalance)

**Problem:** `forceApprove(p.addr, amount)` before deposit, but no `forceApprove(p.addr, 0)` after. If protocol doesn't consume full approval, residual persists.

**Fix -- add after each deposit call in both deposit() and rebalance():**

```solidity
usdc.forceApprove(p.addr, amount);
// ... deposit call ...
usdc.forceApprove(p.addr, 0);  // ADD: clear residual
```

---

## NM-009 [LOW]: SwapStrategyAdapter tokenIn == tokenOut Balance Delta Error

**File:** `src/adapters/SwapStrategyAdapter.sol:67-74`

**Problem:** When `tokenIn == tokenOut`, `balBefore` includes the input tokens transferred by executor. After swap, `received = newBalance - balBefore` gives wrong result (could underflow).

**Fix -- either block or handle:**

```solidity
// Option A: Block the edge case
if (token == outToken) revert SameTokenSwap();

// Option B: Adjust calculation
uint256 balBefore;
if (token == outToken) {
    balBefore = IERC20(outToken).balanceOf(address(this)) - amount;
} else {
    balBefore = IERC20(outToken).balanceOf(address(this));
}
```

---

# PART 2: MISSING TEST CASES

> Organized by contract. Each test has: name, what it verifies, expected behavior.
> Priority: P0 (must have) / P1 (should have) / P2 (nice to have)

---

## 1. FortVault

### 1.1 deposit() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 1 | `test_deposit_emptyArray_reverts` | Empty `DepositEntry[]` | Revert `ZeroAmount` (total=0) | P0 |
| 2 | `test_deposit_duplicateProtocol_succeeds` | Two entries with same `protocolKey` | Both deposits execute, total USDC correct | P0 |
| 3 | `test_deposit_singleEntryZeroAmount_reverts` | `[{key, amount: 0, data}]` | Revert `ZeroAmount` | P0 |
| 4 | `test_deposit_mixedZeroAndNonZero_reverts` | `[{key, 100}, {key, 0}]` total=100 | Succeeds (total > 0) but 0-amount entry behavior? Protocol gets 0 deposit. Verify no revert or document. | P1 |
| 5 | `test_deposit_protocolRevertsMiddle_fullRevert` | First entry succeeds, second reverts | Entire tx reverts, user keeps all USDC | P0 |
| 6 | `test_deposit_residualApproval_afterSuccess` | Check USDC allowance to protocol after deposit | Allowance should be 0 (or document if non-zero per NM-008) | P1 |
| 7 | `test_deposit_veryLargeAmount` | Deposit `type(uint256).max / 2` | Either succeeds or reverts safely (no overflow) | P2 |
| 8 | `test_deposit_maxEntries_gasLimit` | 50+ entries in single deposit | Verify gas stays within block limit or fails gracefully | P2 |

### 1.2 withdraw() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 9 | `test_withdraw_emptyArray_succeeds` | Empty `WithdrawEntry[]` | Loop does nothing. Succeeds (no revert). Emit Withdrawn(user, 0)? | P0 |
| 10 | `test_withdraw_zeroShares_behavior` | Entry with `shares=0` | Protocol behavior depends on implementation. Test both ERC4626 and adapter paths. | P1 |
| 11 | `test_withdraw_insufficientShares_reverts` | `shares > user's actual balance` | Revert from protocol (ERC4626: ERC20InsufficientBalance) | P0 |
| 12 | `test_withdraw_duplicateProtocol_succeeds` | Two entries withdrawing from same protocol | Both execute, user gets USDC from both | P1 |

### 1.3 rebalance() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 13 | `test_rebalance_sameProtocol_fromAndTo` | `fromProtocol == toProtocol` | Succeeds (redeem then deposit same protocol). Verify shares == original minus fees. | P0 |
| 14 | `test_rebalance_zeroShares_reverts` | `shares=0` | Protocol revert (ERC4626: zero redeem) | P1 |
| 15 | `test_rebalance_noSlippageProtection` | Adapter returns less USDC than expected | Succeeds (no slippage check). Documents NM-007. | P0 |
| 16 | `test_rebalance_residualUsdcInVault` | Protocol sends more USDC than return value | Extra USDC stuck in vault. Verify `usdc.balanceOf(vault) > 0` after tx. Documents stateless violation. | P1 |
| 17 | `test_rebalance_emptyArray_succeeds` | Empty `RebalanceEntry[]` | Loop does nothing, emits event. | P1 |
| 18 | `test_rebalance_whenPaused_reverts` | Call rebalance while paused | Revert `EnforcedPause` | P0 |
| 19 | `test_rebalance_multiEntry_partialFail` | First entry succeeds, second reverts | Entire tx reverts. USDC from first redeem returned (atomic). | P1 |

### 1.4 swapAndDeposit() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 20 | `test_swapAndDeposit_bpsZeroEntry` | Entry with `bps=0` in array | `amount = 0` for that entry. Protocol deposits 0. | P1 |
| 21 | `test_swapAndDeposit_dustRounding_noWeiLeft` | 1000e6 USDC across 3 entries at 3333/3333/3334 bps | Last entry gets remainder. `usdc.balanceOf(vault) == 0` after tx. | P0 |
| 22 | `test_swapAndDeposit_deadlineExact_succeeds` | `block.timestamp == deadline` | Succeeds (check is `>`, not `>=`) | P0 |
| 23 | `test_swapAndDeposit_emptySwapData_reverts` | Empty `LibSwap.SwapData[]` | LiFi call fails or swap returns 0 | P1 |
| 24 | `test_swapAndDeposit_noEntries_reverts` | `entries.length == 0` | Revert `ZeroAmount` | P0 |

### 1.5 Registry Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 25 | `test_registerProtocol_afterRemoval_succeeds` | Remove "morpho", then re-register "morpho" with new address | Succeeds, new address in registry | P0 |
| 26 | `test_removeProtocol_lastOne_countZero` | Register one, remove it | `protocolCount() == 0`, `protocolKeys` empty | P1 |

---

## 2. FortStrategyExecutor

### 2.1 executeStrategy() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 27 | `test_executeStrategy_outputTokenNotSwept` | BORROW step output token != any tokenIn | Output token stuck in executor. `IERC20(borrowedToken).balanceOf(executor) > 0` after tx. Documents NM-002. | P0 |
| 28 | `test_executeStrategy_1weiInput_lowBps_reverts` | `inputAmount=1`, `bps=5000` -> `amount = (1*5000)/10000 = 0` | Revert `ZeroAmount` | P0 |
| 29 | `test_executeStrategy_amountFixed_exceedsBalance_reverts` | `amountFixed = 1000e6` but executor only has 100e6 | Revert from `safeTransfer` (insufficient balance) | P0 |
| 30 | `test_executeStrategy_deadlineExact_succeeds` | `block.timestamp == deadline` | Succeeds (check is `>`, not `>=`) | P1 |
| 31 | `test_executeStrategy_adapterReturnsWrongTokenOut` | Adapter claims `tokenOut=WETH` but actually sends DAI | Output check uses total balance of claimed token. If executor has no WETH, revert `InsufficientOutput`. | P1 |
| 32 | `test_executeStrategy_outputCheckTotalNotDelta` | Step 1 produces 100 WETH. Step 2 adapter returns `amountOut=100` but sends 0. | Check passes because executor still has 100 WETH from step 1. Documents NM-005. | P0 |
| 33 | `test_executeStrategy_duplicateTokenInSweep` | Multiple steps with same tokenIn | Sweep called multiple times on same token. Second sweep sends 0. No revert. | P2 |
| 34 | `test_executeStrategy_30Steps_gasWithinLimit` | Exactly 30 steps with real adapter calls | Tx succeeds within block gas limit | P2 |
| 35 | `test_executeStrategy_borrowThenUseOutput` | Step 1: supply collateral. Step 2: borrow (output-only). Step 3: use borrowed token. | Full chain works. Borrowed token available for step 3. | P0 |
| 36 | `test_executeStrategy_withdrawCollateral_outputSwept` | WITHDRAW_COLLATERAL as last step, user sets `tokenIn=collateralToken` | Collateral swept to user via tokenIn sweep path. Workaround for NM-002. | P1 |

### 2.2 Adapter Registry Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 37 | `test_registerAdapter_addressZero_succeeds` | Register `adapters[1] = address(0)` | Succeeds (no zero-check!). Then `executeStrategy` with adapterId=1 reverts `AdapterNotRegistered`. Bug: registration allows address(0) but execution rejects it. | P0 |
| 38 | `test_registerAdapter_afterRemoval_succeeds` | Remove adapterId=1, then re-register adapterId=1 with new address | Succeeds, new address returned by `getAdapter(1)` | P1 |
| 39 | `test_removeAdapter_allAdapters_emptyArray` | Register 3 adapters, remove all 3 | `adapterCount() == 0` | P1 |

### 2.3 Admin Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 40 | `test_rescueToken_zeroAmount` | `rescueToken(token, to, 0)` | Succeeds, transfers nothing | P2 |
| 41 | `test_rescueToken_moreThanBalance_reverts` | `rescueToken(token, to, balance + 1)` | Revert from `safeTransfer` | P1 |
| 42 | `test_pause_doublePause` | Call `pause()` twice | Second call reverts `EnforcedPause` (already paused) | P2 |
| 43 | `test_unpause_doubleUnpause` | Call `unpause()` twice | Second call reverts `ExpectedPause` (already unpaused) | P2 |

---

## 3. CrossChainRouter

### 3.1 depositCrossChain() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 44 | `test_depositCrossChain_lifiSwapInsteadOfBridge` | Craft `lifiData` to call swap function on LiFi | Balance check passes (USDC consumed). Request created. Documents NM-003 attack vector. | P0 |
| 45 | `test_depositCrossChain_lifiOverConsumes_reverts` | LiFi somehow consumes more than `usdcAmount` | Approval caps at `usdcAmount` so `transferFrom` limited. Verify no over-consumption. | P1 |
| 46 | `test_depositCrossChain_destChainIdZero` | `destChainId = 0` | Succeeds (no validation on destChainId). Request stored with chainId=0. | P2 |
| 47 | `test_depositCrossChain_deadlineExact_succeeds` | `block.timestamp == deadline` | Succeeds (check is `>`, not `>=`) | P1 |

### 3.2 refundDeposit() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 48 | `test_refundDeposit_noDelayEnforced` | Mark failed, immediately refund (same block) | Succeeds. Documents NM-004 (REFUND_DELAY not enforced). | P0 |
| 49 | `test_refundDeposit_zeroAmountRequest` | Deposit request with `amount=0` (impossible via `depositCrossChain` but test the refund path) | `safeTransfer(user, 0)` succeeds, does nothing | P2 |

### 3.3 State Transition Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 50 | `test_markCompleted_thenMarkFailed_reverts` | `markDepositCompleted()` then `markDepositFailed()` on same request | Revert `InvalidRequestStatus` (already Completed) | P0 |
| 51 | `test_markFailed_thenMarkCompleted_reverts` | `markDepositFailed()` then `markDepositCompleted()` on same request | Revert `InvalidRequestStatus` (already Failed) | P0 |
| 52 | `test_cancelWithdraw_failedStatus_reverts` | Create withdraw, keeper marks it somehow... wait, withdrawals don't have Failed status path. Test cancel on Completed. | Revert `InvalidRequestStatus` | P1 |

### 3.4 fulfillWithdraw() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 53 | `test_fulfillWithdraw_massiveActualAmount` | `actualAmount = type(uint256).max / 2` | Revert `InsufficientBalance` (router doesn't hold that much) | P1 |
| 54 | `test_fulfillWithdraw_exactFreeBalance` | Free balance == actualAmount exactly | Succeeds. `pendingWithdrawBalance` equals total USDC balance. | P0 |

### 3.5 claimWithdraw() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 55 | `test_claimWithdraw_routerBalanceDrained` | Fulfill withdraw, then somehow drain USDC (e.g., rescue), then claim | Revert from `safeTransfer` (insufficient balance). Note: `rescueToken` guards against this for USDC. | P1 |
| 56 | `test_claimWithdraw_nonExistentRequest` | Claim with random `requestId` | Revert `RequestNotFound` (user == address(0)) | P1 |

### 3.6 Admin Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 57 | `test_setKeeper_sameAddress` | Set keeper to current keeper | Succeeds (idempotent). Event emitted with old==new. | P2 |
| 58 | `test_rescueToken_zeroAmount` | `rescueToken(usdc, to, 0)` | Succeeds, transfers nothing | P2 |

---

## 4. LiFiAdapter

### 4.1 depositFor() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 59 | `test_depositFor_multipleSwapData` | `SwapData[]` with 2+ elements, all valid | All elements validated. Only first `fromAmount` overridden. | P0 |
| 60 | `test_depositFor_secondSwapUnauthorized_reverts` | `SwapData[0]` valid, `SwapData[1].callTo` not approved | Revert `UnauthorizedCallTo` on second element | P0 |
| 61 | `test_depositFor_zeroUsdcAmount` | `usdcAmount = 0` | Behavior depends on LiFi. Document. | P2 |

### 4.2 redeemFor() Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 62 | `test_redeemFor_residualApprovalPersists` | After successful redeem, check `sourceToken.allowance(adapter, lifiDiamond)` | Non-zero if LiFi didn't consume all. Documents NM-006. | P0 |
| 63 | `test_redeemFor_zeroUsdcOutput` | Swap produces 0 USDC (bad rate) | `usdcOut = 0`, `safeTransfer(receiver, 0)` succeeds. minUsdcOut check in LiFi should catch. | P1 |
| 64 | `test_redeemFor_multipleSwapData` | Multi-hop redeem with 2+ swap steps | All elements validated, swap executes through hops. | P1 |

### 4.3 Admin Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 65 | `test_setApprovedDex_twice_idempotent` | `setApprovedDex(dex, true)` twice | No revert, same state | P2 |
| 66 | `test_rescueToken_zeroAmount` | `rescueToken(token, to, 0)` | Succeeds | P2 |

---

## 5. MorphoStrategyAdapter

### 5.1 Action Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 67 | `test_supplyCollateral_zeroAmount` | `amount = 0` | Morpho behavior (likely succeeds, supplies nothing) | P1 |
| 68 | `test_borrow_zeroAmount` | `borrowAmount = 0` in data encoding | Morpho reverts or returns 0 | P1 |
| 69 | `test_repay_moreThanDebt` | Repay 1000 when debt is only 500 | Morpho repays only 500, returns actual repaid. Excess token stays in adapter. | P0 |
| 70 | `test_repay_noExistingDebt` | Repay when user has no borrow position | Morpho reverts or repays 0 | P1 |
| 71 | `test_withdrawCollateral_moreThanAvailable` | Withdraw 1000 collateral when only 500 deposited | Morpho reverts (insufficient collateral) | P0 |
| 72 | `test_withdrawCollateral_wouldBreakHealthFactor` | Withdraw enough to make position liquidatable | Morpho reverts (insufficient liquidity) | P1 |
| 73 | `test_borrow_wouldBreakHealthFactor` | Borrow more than collateral supports | Morpho reverts (insufficient collateral) | P1 |
| 74 | `test_execute_depositErc4626Action_reverts` | Call with `ActionType.DEPOSIT_ERC4626` | Revert `UnsupportedAction` | P1 |
| 75 | `test_execute_redeemErc4626Action_reverts` | Call with `ActionType.REDEEM_ERC4626` | Revert `UnsupportedAction` | P1 |

### 5.2 Authorization Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 76 | `test_borrow_userNotAuthorized_reverts` | User hasn't called `morpho.setAuthorization(adapter, true)` | Morpho reverts (unauthorized) | P0 |

---

## 6. SwapStrategyAdapter

### 6.1 Swap Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 77 | `test_swap_tokenInEqualsTokenOut_underflow` | `token == outToken`, swap produces less than input | `balanceOf - balBefore` underflows. Documents NM-009. | P0 |
| 78 | `test_swap_tokenInEqualsTokenOut_profitable` | `token == outToken`, swap produces more than input | `received = newBal - (oldBal including input)`. Result is correct only if output > input. | P0 |
| 79 | `test_swap_dexReturnsZero_minAmountZero` | DEX returns 0 output, `minAmountOut = 0` | `0 >= 0` passes. 0 tokens sent to executor. Useless but no revert. | P1 |
| 80 | `test_swap_zeroAmount_fromExecutor` | Executor sends `amount = 0` to adapter | `forceApprove(dex, 0)`, DEX called with 0 input. Likely reverts at DEX. | P1 |
| 81 | `test_swap_approvedDexIsAddressZero` | `isApprovedDex[address(0)] = true`, then swap with `dex = address(0)` | `address(0).call()` fails | P2 |

### 6.2 Admin Edge Cases

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 82 | `test_setApprovedDex_thenRevoke_thenSwap_reverts` | Approve dex, revoke, attempt swap | Revert `UnauthorizedDex` | P1 |
| 83 | `test_setExecutor_thenCallFromOldExecutor_reverts` | Change executor, old executor calls `execute()` | Revert `OnlyExecutor` | P1 |
| 84 | `test_rescueToken_moreThanBalance_reverts` | `rescueToken(token, to, balance + 1)` | Revert from `safeTransfer` | P2 |

---

## 7. Cross-System / Reentrancy

> These tests validate that the `nonReentrant` modifier actually blocks callback-based reentrancy.
> Create a `ReentrantMock` contract that calls back into the victim during a token transfer or protocol interaction.

| # | Test Name | What It Verifies | Expected | Priority |
|---|-----------|-----------------|----------|----------|
| 85 | `test_reentrancy_vaultDeposit_blocked` | Malicious protocol calls `vault.deposit()` during its `depositFor()` callback | Revert `ReentrancyGuardReentrantCall` | P0 |
| 86 | `test_reentrancy_vaultWithdraw_blocked` | Malicious protocol calls `vault.withdraw()` during its `redeemFor()` callback | Revert `ReentrancyGuardReentrantCall` | P0 |
| 87 | `test_reentrancy_vaultRebalance_blocked` | Malicious protocol calls `vault.rebalance()` during redeem callback | Revert `ReentrancyGuardReentrantCall` | P0 |
| 88 | `test_reentrancy_executorStrategy_blocked` | Malicious adapter calls `executor.executeStrategy()` during its `execute()` callback | Revert `ReentrancyGuardReentrantCall` | P0 |
| 89 | `test_reentrancy_routerDeposit_blocked` | LiFi Diamond callback re-enters `depositCrossChain()` | Revert `ReentrancyGuardReentrantCall` | P0 |
| 90 | `test_reentrancy_routerClaim_blocked` | Token transfer callback re-enters `claimWithdraw()` | Revert `ReentrancyGuardReentrantCall` | P0 |

### Reentrancy Mock Template

```solidity
contract ReentrantProtocol is IFortProtocol {
    FortVault public vault;
    bool public shouldReenter;

    function depositFor(uint256 amount, address receiver) external {
        if (shouldReenter) {
            // Attempt reentrancy
            FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
            entries[0] = FortVault.DepositEntry(keccak256("reentrant"), amount, "");
            vault.deposit(entries);  // Should revert
        }
    }

    function redeemFor(uint256, address, address) external returns (uint256) {
        return 0;
    }
}
```

---

## SUMMARY

| Category | Test Count | Priority Breakdown |
|----------|-----------|-------------------|
| FortVault edge cases | 26 | 10 P0, 10 P1, 6 P2 |
| FortStrategyExecutor edge cases | 17 | 8 P0, 5 P1, 4 P2 |
| CrossChainRouter edge cases | 15 | 5 P0, 6 P1, 4 P2 |
| LiFiAdapter edge cases | 8 | 2 P0, 3 P1, 3 P2 |
| MorphoStrategyAdapter edge cases | 10 | 3 P0, 6 P1, 1 P2 |
| SwapStrategyAdapter edge cases | 8 | 2 P0, 3 P1, 3 P2 |
| Reentrancy tests | 6 | 6 P0 |
| **TOTAL** | **~90** | **36 P0, 33 P1, 21 P2** |

### Recommended Implementation Order

1. **Reentrancy tests** (6 tests) -- validates core security assumption
2. **NM-002 sweep gap test** (#27) -- proves the bug exists
3. **NM-003 raw lifiData test** (#44) -- proves the attack vector
4. **NM-009 tokenIn==tokenOut test** (#77, #78) -- proves the math error
5. **All remaining P0 tests** (36 total) -- critical boundary conditions
6. **P1 tests** (33 total) -- thorough coverage
7. **P2 tests** (21 total) -- completeness
