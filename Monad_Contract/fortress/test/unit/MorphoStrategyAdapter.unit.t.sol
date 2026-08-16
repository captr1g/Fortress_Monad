// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockMorphoBlue.sol";
import "../mocks/MockOracle.sol";

contract MorphoStrategyAdapterUnitTest is Test {
    MorphoStrategyAdapter internal adapter;
    MockMorphoBlue internal morpho;
    MockOracle internal oracle;
    MockUSDC internal usdc; // loan token (6 dec)
    MockERC20 internal yoUSD; // collateral token (18 dec)

    address internal owner;
    address internal executorAddr = address(0xE);
    address internal user = address(0xA1);
    address internal nonExecutor = address(0xBAD);

    // 1 yoUSD (18 dec) == 1 USDC (6 dec) of value, Morpho price scale 1e36:
    //   price = 1e36 * 1e6 / 1e18 = 1e24
    uint256 internal constant ORACLE_PRICE_1TO1 = 1e24;
    uint256 internal constant LLTV_915 = 915000000000000000; // 91.5%

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);
        morpho = new MockMorphoBlue();
        oracle = new MockOracle(ORACLE_PRICE_1TO1);

        MorphoStrategyAdapter impl = new MorphoStrategyAdapter(address(morpho));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(MorphoStrategyAdapter.initialize, (executorAddr, owner))
        );
        adapter = MorphoStrategyAdapter(address(proxy));

        // Fund morpho with a USDC reserve for borrows.
        usdc.mint(address(this), 1_000_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1_000_000e6);
    }

    function _market() internal view returns (IMorphoBlue.MarketParams memory) {
        return
            IMorphoBlue.MarketParams({
                loanToken: address(usdc),
                collateralToken: address(yoUSD),
                oracle: address(oracle),
                irm: address(0),
                lltv: LLTV_915
            });
    }

    /// @dev Supply `amount` of collateral for `user` via the adapter (helper for borrow tests).
    function _supply(uint256 amount) internal {
        yoUSD.mint(address(adapter), amount);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            address(yoUSD),
            amount,
            user,
            abi.encode(_market())
        );
    }

    /// @dev Encode borrow data (market, targetLtv, maxBorrow, minBorrow=0 unless given).
    function _borrowData(
        uint256 targetLtvWad,
        uint256 maxBorrow
    ) internal view returns (bytes memory) {
        return abi.encode(_market(), targetLtvWad, maxBorrow, uint256(0));
    }

    function _borrowData(
        uint256 targetLtvWad,
        uint256 maxBorrow,
        uint256 minBorrow
    ) internal view returns (bytes memory) {
        return abi.encode(_market(), targetLtvWad, maxBorrow, minBorrow);
    }

    function _ownableErr(address who) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
                who
            );
    }

    // ──────────────────────────── onlyExecutor ────────────────────────────

    function test_execute_nonExecutor_reverts() public {
        vm.prank(nonExecutor);
        vm.expectRevert(MorphoStrategyAdapter.OnlyExecutor.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            address(yoUSD),
            1e18,
            user,
            abi.encode(_market())
        );
    }

    // ──────────────────────────── SUPPLY_COLLATERAL ────────────────────────────

    function test_supplyCollateral_incrementsPosition() public {
        uint256 amount = 100e18;
        // Executor would have transferred collateral to the adapter first.
        yoUSD.mint(address(adapter), amount);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            address(yoUSD),
            amount,
            user,
            abi.encode(_market())
        );

        assertEq(tokenOut, address(0));
        assertEq(amountOut, 0);

        (, , uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, uint128(amount));
    }

    // ──────────────────────────── BORROW (oracle-sized) ────────────────────────────

    function test_borrow_sizesToTargetLtv_andForwardsToExecutor() public {
        // Supply 100 yoUSD collateral (worth 100 USDC at 1:1 oracle).
        _supply(100e18);

        // Expected borrow = collateralValue(100 USDC) * 80% - currentDebt(0) = 80 USDC.
        uint256 expected = 80e6;

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );

        assertEq(tokenOut, address(usdc));
        assertEq(amountOut, expected);
        assertEq(usdc.balanceOf(executorAddr), expected);

        (, uint128 borrowShares, ) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, uint128(expected));
    }

    function test_borrow_emitsBorrowExecutedEvent() public {
        _supply(100e18);
        bytes32 id = keccak256(abi.encode(_market()));

        vm.expectEmit(true, true, false, true, address(adapter));
        emit MorphoStrategyAdapter.BorrowExecuted(
            user,
            id,
            100e18, // collateral
            100e6, // collateralValue (100 USDC at 1:1)
            0.8e18, // targetLtvWad
            80e6, // targetDebt
            0, // currentDebt
            80e6 // borrowed
        );

        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
    }

    function test_borrow_secondCallOnlyBorrowsTheGap() public {
        _supply(100e18);

        // First borrow to 50%.
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.5e18, 100e6)
        );
        assertEq(usdc.balanceOf(executorAddr), 50e6);

        // Now target 80%: should borrow only the 30 USDC gap, not another 80.
        vm.prank(executorAddr);
        (, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
        assertEq(amountOut, 30e6);
        assertEq(usdc.balanceOf(executorAddr), 80e6);
    }

    function test_borrow_revertsWhenNoCollateral() public {
        // No supply step — position has zero collateral.
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.NoCollateral.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
    }

    function test_borrow_revertsWhenOraclePriceZero() public {
        _supply(100e18);
        oracle.setPrice(0);
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.OraclePriceZero.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
    }

    function test_borrow_revertsWhenBelowDustFloor() public {
        _supply(100e18);
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(MorphoStrategyAdapter.BorrowBelowMinimum.selector, 80e6, 100e6)
        );
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 1_000e6, 100e6)
        );
    }

    function test_borrow_revertsWhenComputedExceedsCeiling() public {
        _supply(100e18);
        // Target 80% => wants 80 USDC, but ceiling is only 50 USDC.
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                MorphoStrategyAdapter.BorrowExceedsCeiling.selector,
                80e6,
                50e6
            )
        );
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 50e6)
        );
    }

    function test_borrow_revertsWhenTargetLtvAtOrAboveLltv() public {
        _supply(100e18);
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.InvalidTargetLtv.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.92e18, 1_000e6) // > 91.5% LLTV
        );
    }

    function test_borrow_revertsWhenAlreadyAtTarget() public {
        _supply(100e18);
        // Borrow to 80% first.
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
        // Asking for 50% now would require *repaying*, so there is nothing to borrow.
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.NothingToBorrow.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.5e18, 100e6)
        );
    }

    function test_borrow_revertsWhenPaused() public {
        _supply(100e18);
        adapter.pause();
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()")))
        );
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.8e18, 100e6)
        );
    }

    // ──────────────────────────── REPAY ────────────────────────────

    function test_repay_decrementsBorrowShares() public {
        // Supply collateral, then borrow to 50% (= 50 USDC) to create debt.
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.5e18, 100e6)
        );
        uint256 borrowAmount = 50e6;

        // Now repay: executor transfers USDC to the adapter first.
        uint256 repayAmount = 20e6;
        usdc.mint(address(adapter), repayAmount);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc),
            repayAmount,
            user,
            abi.encode(_market())
        );

        assertEq(tokenOut, address(0));
        assertEq(amountOut, 0);

        (, uint128 borrowShares, ) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, uint128(borrowAmount - repayAmount));
    }

    function test_repay_excessReturnedToExecutor() public {
        // Supply collateral, then borrow 50 USDC.
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.5e18, 100e6)
        );
        // Debt is now 50 USDC.

        // Try to repay 80 USDC (30 more than actual debt).
        uint256 repayAmount = 80e6;
        usdc.mint(address(adapter), repayAmount);

        // Clear executor balance so we can measure what comes back.
        uint256 execBalBefore = usdc.balanceOf(executorAddr);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc),
            repayAmount,
            user,
            abi.encode(_market())
        );

        // Excess (30 USDC) should be returned to executor.
        assertEq(tokenOut, address(usdc), "tokenOut should be loanToken");
        assertEq(amountOut, 30e6, "amountOut should be the excess");
        assertEq(usdc.balanceOf(executorAddr) - execBalBefore, 30e6, "executor should receive excess");

        // Debt should be fully repaid.
        (, uint128 borrowShares, ) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt should be zero");

        // Adapter should hold nothing.
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter should hold no USDC");
    }

    function test_repay_exactDebt_noExcess() public {
        // Supply collateral, then borrow 50 USDC.
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            _borrowData(0.5e18, 100e6)
        );

        // Repay exactly 50 USDC (== debt). No excess expected.
        uint256 repayAmount = 50e6;
        usdc.mint(address(adapter), repayAmount);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc),
            repayAmount,
            user,
            abi.encode(_market())
        );

        assertEq(tokenOut, address(0), "no excess => tokenOut should be zero");
        assertEq(amountOut, 0, "no excess => amountOut should be zero");

        (, uint128 borrowShares, ) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt should be zero");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter should hold no USDC");
    }

    function test_repay_partialDebt_noExcess() public {
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0), 0, user,
            _borrowData(0.5e18, 100e6)
        );
        // Debt = 50 USDC. Repay 20 — no excess expected.
        uint256 repayAmount = 20e6;
        usdc.mint(address(adapter), repayAmount);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc), repayAmount, user,
            abi.encode(_market())
        );

        assertEq(tokenOut, address(0), "no excess token");
        assertEq(amountOut, 0, "no excess amount");
        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 30e6, "debt should be 30");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter empty");
    }

    function test_repay_fullOverpay_returnsAll() public {
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0), 0, user,
            _borrowData(0.5e18, 100e6)
        );
        // Debt = 50 USDC. Repay 200 — excess = 150.
        uint256 repayAmount = 200e6;
        usdc.mint(address(adapter), repayAmount);
        uint256 execBefore = usdc.balanceOf(executorAddr);

        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc), repayAmount, user,
            abi.encode(_market())
        );

        assertEq(tokenOut, address(usdc), "excess token = loanToken");
        assertEq(amountOut, 150e6, "excess = 150");
        assertEq(usdc.balanceOf(executorAddr) - execBefore, 150e6, "executor got excess");
        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt fully repaid");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter empty");
    }

    function test_repay_adapterHoldsZeroAfterAnyRepay() public {
        _supply(100e18);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0), 0, user,
            _borrowData(0.5e18, 100e6)
        );
        // Debt = 50 USDC. Repay in three steps: 10 (partial), 40 (exact remainder), 100 (overpay on zero).
        uint256[3] memory amounts = [uint256(10e6), uint256(40e6), uint256(100e6)];

        for (uint256 i; i < amounts.length; i++) {
            usdc.mint(address(adapter), amounts[i]);
            vm.prank(executorAddr);
            adapter.execute(
                IStrategyAdapter.ActionType.REPAY,
                address(usdc), amounts[i], user,
                abi.encode(_market())
            );
            assertEq(usdc.balanceOf(address(adapter)), 0, "adapter must be empty after repay");
        }
    }

    // ──────────────────────────── WITHDRAW_COLLATERAL ────────────────────────────

    function test_withdrawCollateral_sendsToExecutor() public {
        // Supply collateral first.
        uint256 supply = 100e18;
        yoUSD.mint(address(adapter), supply);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            address(yoUSD),
            supply,
            user,
            abi.encode(_market())
        );

        uint256 withdrawAmount = 40e18;
        vm.prank(executorAddr);
        (address tokenOut, uint256 amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.WITHDRAW_COLLATERAL,
            address(0),
            0,
            user,
            abi.encode(_market(), withdrawAmount)
        );

        assertEq(tokenOut, address(yoUSD));
        assertEq(amountOut, withdrawAmount);
        assertEq(yoUSD.balanceOf(executorAddr), withdrawAmount);

        (, , uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, uint128(supply - withdrawAmount));
    }

    // ──────────────────────────── unsupported action ────────────────────────────

    function test_swapAction_reverts() public {
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.UnsupportedAction.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            1e6,
            user,
            ""
        );
    }

    // ──────────────────────────── setExecutor ────────────────────────────

    function test_setExecutor_owner() public {
        address newExec = address(0xBEEF);
        adapter.setExecutor(newExec);
        assertEq(adapter.executor(), newExec);
    }

    function test_setExecutor_zero_reverts() public {
        vm.expectRevert(MorphoStrategyAdapter.ZeroExecutor.selector);
        adapter.setExecutor(address(0));
    }

    function test_setExecutor_nonOwner_reverts() public {
        vm.prank(nonExecutor);
        vm.expectRevert(_ownableErr(nonExecutor));
        adapter.setExecutor(address(0xBEEF));
    }

    // ──────────────────────────── rescueToken ────────────────────────────

    function test_rescueToken_owner() public {
        usdc.mint(address(adapter), 100e6);
        address recipient = address(0xCC);
        adapter.rescueToken(address(usdc), recipient, 100e6);
        assertEq(usdc.balanceOf(recipient), 100e6);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);
        vm.prank(nonExecutor);
        vm.expectRevert(_ownableErr(nonExecutor));
        adapter.rescueToken(address(usdc), nonExecutor, 100e6);
    }
}
