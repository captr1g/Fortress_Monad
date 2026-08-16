// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortStrategyExecutor.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockDex.sol";

/// @title FortStrategyExecutor gas envelopes (invariant I13)
///
/// @notice Phase 3, written BEFORE the optimisation it justifies (prompt §7:
///         "Test first, always").
///
/// @dev **Gas numbers from upstream Foundry are NOT authoritative.** Phase 0
///      measured upstream at ~2,165 gas per marginal cold SLOAD against Monad's
///      ~8,300 — a 3.85x under-report on exactly the operation this contract does
///      most (RESEARCH.md §3). These tests measure the SHAPE of the cost curve,
///      which is toolchain-independent, and assert envelopes calibrated under
///      Monad Foundry. Run with:
///
///          foundryup --network monad
///          forge test --match-path "test/gas/*" -vv
///
///      The worst case is deliberately constructed: every step outputs a DISTINCT
///      token, which maximises the `prevOutSnaps` scan in the per-step loop. That
///      scan is O(i) per step and therefore O(n^2) across the strategy, and Phase 0
///      predicted it dominates at high step counts.
contract FortStrategyExecutorGasTest is Test {
    uint8 internal constant SWAP_ID = 0;

    FortStrategyExecutor internal executor;
    SwapStrategyAdapter internal swapAdapter;
    MockDex internal dex;
    MockUSDC internal usdc;

    /// @dev Distinct output token per step — the O(n^2) worst case.
    MockERC20[] internal tokens;

    address internal user = address(0xA1);

    /// @notice Recorded so the derivation in docs/gas-model.md is reproducible.
    uint256[] internal measuredSteps;
    uint256[] internal measuredGas;

    function setUp() public {
        usdc = new MockUSDC();
        dex = new MockDex();

        FortStrategyExecutor impl = new FortStrategyExecutor();
        executor = FortStrategyExecutor(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(FortStrategyExecutor.initialize, ())))
        );

        SwapStrategyAdapter swapImpl = new SwapStrategyAdapter();
        swapAdapter = SwapStrategyAdapter(
            address(
                new ERC1967Proxy(
                    address(swapImpl),
                    abi.encodeCall(SwapStrategyAdapter.initialize, (address(executor), address(this)))
                )
            )
        );

        executor.registerAdapter(SWAP_ID, address(swapAdapter));
        swapAdapter.setApprovedDex(address(dex), true);
        swapAdapter.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        // One distinct 18-decimal token per possible step, each pre-funding the DEX.
        for (uint256 i; i < executor.MAX_STEPS(); i++) {
            MockERC20 t = new MockERC20("Step Token", "STEP", 18);
            t.mint(address(dex), 1_000_000_000e18);
            tokens.push(t);
        }
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    /// @dev Chain of n swaps: USDC -> T0 -> T1 -> ... -> T(n-1).
    ///      Every step emits a token no earlier step emitted.
    function _buildSteps(uint256 n) internal view returns (IFortStrategyExecutor.Step[] memory steps) {
        steps = new IFortStrategyExecutor.Step[](n);
        for (uint256 i; i < n; i++) {
            address tokenIn = i == 0 ? address(usdc) : address(tokens[i - 1]);
            address tokenOut = address(tokens[i]);
            uint256 amountIn = 1_000e18;
            uint256 amountOut = 1_000e18;
            if (i == 0) amountIn = 1_000e6; // USDC is 6-decimal

            bytes memory swapCalldata =
                abi.encodeCall(MockDex.swapExact, (tokenIn, amountIn, tokenOut, amountOut, address(swapAdapter)));
            steps[i] = IFortStrategyExecutor.Step({
                adapterId: SWAP_ID,
                action: IStrategyAdapter.ActionType.SWAP,
                tokenIn: tokenIn,
                amountFixed: amountIn,
                bps: 0,
                // minAmountOut must be non-zero: SwapStrategyAdapter enforces I8
                // (slippage bounds) and reverts ZeroMinAmountOut otherwise.
                data: abi.encode(address(dex), tokenOut, amountOut, false, swapCalldata)
            });
        }
    }

    function _sweepList(uint256 n) internal view returns (address[] memory sweep) {
        sweep = new address[](n + 1);
        sweep[0] = address(usdc);
        for (uint256 i; i < n; i++) {
            sweep[i + 1] = address(tokens[i]);
        }
    }

    /// @dev Runs an n-step strategy and returns gas consumed by executeStrategy alone.
    function _measure(uint256 n) internal returns (uint256 gasUsed) {
        IFortStrategyExecutor.Step[] memory steps = _buildSteps(n);
        address[] memory sweep = _sweepList(n);

        usdc.mint(user, 1_000e6);
        vm.prank(user);
        usdc.approve(address(executor), 1_000e6);

        vm.prank(user);
        uint256 before = gasleft();
        executor.executeStrategy(address(usdc), 1_000e6, steps, sweep, block.timestamp + 600);
        gasUsed = before - gasleft();
    }

    /*//////////////////////////////////////////////////////////////
                          THE MEASURED CURVE
    //////////////////////////////////////////////////////////////*/

    /// @notice Emits the full gas curve. This is the measurement the MAX_STEPS
    ///         derivation in docs/gas-model.md is built from.
    function test_gasCurve_byStepCount() public {
        uint256[9] memory ns = [uint256(1), 2, 4, 8, 12, 16, 20, 25, 30];

        console.log("n_steps,gas_used,marginal_per_step");
        uint256 prev;
        for (uint256 k; k < ns.length; k++) {
            uint256 n = ns[k];
            if (n > executor.MAX_STEPS()) continue;

            uint256 g = _measure(n);
            measuredSteps.push(n);
            measuredGas.push(g);

            // Guarded: the FIRST measurement pays one-time cold-state warmup for the
            // USDC balance/allowance slots that later measurements inherit warm. Under
            // Monad's ~4x cold pricing that one-off is big enough to make gas(2) land
            // BELOW gas(1), so a naive subtraction underflows. Report 0 rather than
            // panicking — the marginal only becomes meaningful once state is warm.
            uint256 marginal = (k == 0 || g < prev) ? 0 : (g - prev) / (n - ns[k - 1]);
            console.log(string.concat(vm.toString(n), ",", vm.toString(g), ",", vm.toString(marginal)));
            prev = g;
        }
    }

    /// @notice Proves the per-step cost GROWS with step count — the signature of a
    ///         superlinear term. A purely linear executor would hold this flat.
    /// @dev This assertion is toolchain-independent: it compares Monad against
    ///      Monad (or upstream against upstream), never across the two.
    function test_perStepCost_growsWithStepCount() public {
        // MARGINAL cost, not average. Average is dominated at low n by the fixed
        // per-call overhead (transferFrom, pause/reentrancy checks) and would hide
        // the superlinear term rather than expose it.
        //
        // Sample points scale with MAX_STEPS so this keeps working if the bound is
        // re-derived. The full 1..30 curve in docs/gas-model.md §3 was captured
        // before MAX_STEPS was reduced to 10 and cannot be reproduced at runtime now.
        uint256 max = executor.MAX_STEPS();
        uint256 lo = max / 4; // e.g. 2 at MAX_STEPS=10
        uint256 mid = max / 2; // e.g. 5
        uint256 hi = max; // e.g. 10

        uint256 gLo = _measure(lo);
        uint256 gMid = _measure(mid);
        uint256 gHi = _measure(hi);

        uint256 marginalLow = (gMid - gLo) / (mid - lo);
        uint256 marginalHigh = (gHi - gMid) / (hi - mid);

        console.log("marginal per step, lower half:", marginalLow);
        console.log("marginal per step, upper half:", marginalHigh);

        // Each additional step adds one more iteration to the prevOutSnaps scan,
        // so later steps cost strictly more than earlier ones.
        assertGt(marginalHigh, marginalLow, "expected superlinear growth in marginal per-step cost");
    }

    /*//////////////////////////////////////////////////////////////
                        I13 — BOUNDED, MEASURED GAS
    //////////////////////////////////////////////////////////////*/

    /// @notice I13: the worst-case strategy must fit well inside a Monad block, and
    ///         inside the 30M per-transaction limit documented by the Monad gas
    ///         docs (RESEARCH.md §8.2 records that 30M cap as UNRESOLVED — the RPC
    ///         accepts up to the 150M block limit, so this asserts the tighter of
    ///         the two, which is the safe direction).
    function test_I13_worstCaseStrategy_withinPerTxGasCap() public {
        uint256 g = _measure(executor.MAX_STEPS());
        console.log("worst-case gas at MAX_STEPS:", g);

        uint256 PER_TX_CAP = 30_000_000;
        assertLt(g, PER_TX_CAP / 2, "worst case must leave >=50% headroom under the 30M per-tx cap");
    }

    /// @notice I13: gas must be bounded in user-supplied array length — a caller
    ///         must not be able to grow the sweep list without bound.
    function test_I13_sweepTokens_boundedCost() public {
        uint256 gSmall = _measure(2);
        uint256 gLarge = _measure(8);
        assertLt(gLarge, gSmall * 10, "sweep cost must not explode with token count");
    }
}
