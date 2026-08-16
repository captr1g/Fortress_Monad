// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/MorphoExitExecutor.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockMorphoBlue.sol";
import "../mocks/MockDex.sol";
import "../mocks/MockOracle.sol";

contract MorphoExitExecutorUnitTest is Test {
    uint256 internal constant LLTV = 915000000000000000;
    uint256 internal constant ORACLE_PRICE_1TO1 = 1e24;

    MorphoExitExecutor internal exit;
    MockMorphoBlue internal morpho;
    MockDex internal dex;
    MockOracle internal oracle;
    MockUSDC internal usdc;
    MockERC20 internal collat;

    address internal owner;
    address internal user = address(0xA1);

    function setUp() public {
        owner = address(this);

        usdc = new MockUSDC();
        collat = new MockERC20("Coinbase BTC", "cbBTC", 8);

        morpho = new MockMorphoBlue();
        dex = new MockDex();
        oracle = new MockOracle(ORACLE_PRICE_1TO1);

        MorphoExitExecutor impl = new MorphoExitExecutor(address(morpho));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(MorphoExitExecutor.initialize, (owner)));
        exit = MorphoExitExecutor(address(proxy));
        exit.setApprovedDex(address(dex), true);
        exit.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        // Fund Morpho with a USDC reserve for borrows + flash loans.
        usdc.mint(address(this), 1_000_000_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1_000_000_000e6);

        // Fund the DEX with USDC so it can serve collateral→USDC swaps.
        usdc.mint(address(dex), 1_000_000_000e6);
    }

    function _market() internal view returns (IMorphoBlue.MarketParams memory) {
        return IMorphoBlue.MarketParams({
            loanToken: address(usdc),
            collateralToken: address(collat),
            oracle: address(oracle),
            irm: address(0),
            lltv: LLTV
        });
    }

    // Open a position directly on the mock: user supplies `collateralAmt` and borrows `debtAmt`.
    function _openPosition(uint256 collateralAmt, uint256 debtAmt) internal {
        collat.mint(user, collateralAmt);
        vm.startPrank(user);
        collat.approve(address(morpho), collateralAmt);
        morpho.supplyCollateral(_market(), collateralAmt, user, "");
        morpho.borrow(_market(), debtAmt, 0, user, user);
        morpho.setAuthorization(address(exit), true);
        // The mock sends borrow proceeds to the user; in a real loop these are swapped
        // into collateral. Move them out so exit-proceed assertions are clean.
        usdc.transfer(address(0xdead), usdc.balanceOf(user));
        vm.stopPrank();
    }

    function _swapCalldata(uint256 amountIn, uint256 amountOut, address recipient)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(MockDex.swapExact, (address(collat), amountIn, address(usdc), amountOut, recipient));
    }

    function testFullExitToLoanReturnsSurplusUsdc() public {
        uint256 collateralAmt = 1e8; // 1 cbBTC
        uint256 debtAmt = 600e6; // 600 USDC debt
        _openPosition(collateralAmt, debtAmt);

        // Unwind swap: sell all collateral for 1000 USDC.
        uint256 swapOut = 1000e6;
        bytes memory swapCalldata = _swapCalldata(collateralAmt, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: collateralAmt,
            minLoanOut: 900e6,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        // Debt cleared, collateral gone, surplus USDC (1000 - 600) to user.
        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt not cleared");
        assertEq(collateral, 0, "collateral not withdrawn");
        assertEq(usdc.balanceOf(user), swapOut - debtAmt, "surplus mismatch");
        assertEq(usdc.balanceOf(address(exit)), 0, "executor holds dust usdc");
        assertEq(collat.balanceOf(address(exit)), 0, "executor holds dust collateral");
    }

    function testFullExitToCollateralKeepsResidualCollateral() public {
        uint256 collateralAmt = 1e8;
        uint256 debtAmt = 600e6;
        _openPosition(collateralAmt, debtAmt);

        // Sell only part of the collateral (0.65 cbBTC) for exactly enough to repay.
        uint256 sellIn = 65000000; // 0.65 cbBTC
        uint256 swapOut = 600e6;
        bytes memory swapCalldata = _swapCalldata(sellIn, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_COLLATERAL,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: sellIn,
            minLoanOut: 600e6,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt not cleared");
        assertEq(collateral, 0, "collateral should be fully withdrawn from morpho");
        // Residual collateral returned to user = total - sold.
        assertEq(collat.balanceOf(user), collateralAmt - sellIn, "residual collateral mismatch");
        assertEq(usdc.balanceOf(user), 0, "no surplus usdc expected");
    }

    function testDeleveragePartialRepay() public {
        uint256 collateralAmt = 1e8;
        uint256 debtAmt = 600e6;
        _openPosition(collateralAmt, debtAmt);

        // Repay 200 USDC, withdraw 0.25 cbBTC, sell it for 250 USDC.
        uint256 repay = 200e6;
        uint256 withdraw = 25000000;
        uint256 swapOut = 250e6;
        bytes memory swapCalldata = _swapCalldata(withdraw, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.DELEVERAGE,
            repayAssets: repay,
            withdrawAssets: withdraw,
            swapCollateralIn: withdraw,
            minLoanOut: 200e6,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, debtAmt - repay, "debt not reduced correctly");
        assertEq(collateral, collateralAmt - withdraw, "collateral not reduced correctly");
        assertEq(usdc.balanceOf(user), swapOut - repay, "surplus mismatch");
    }

    function testRevertsWhenDexNotApproved() public {
        _openPosition(1e8, 600e6);
        MockDex rogue = new MockDex();

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 1,
            dex: address(rogue),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoExitExecutor.UnauthorizedDex.selector, address(rogue)));
        exit.exitPosition(p);
    }

    function testRevertsOnSlippage() public {
        _openPosition(1e8, 600e6);

        // Swap only returns 600, but we demand minLoanOut of 900.
        bytes memory swapCalldata = _swapCalldata(1e8, 600e6, address(exit));
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 900e6,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoExitExecutor.SlippageExceeded.selector, 600e6, 900e6));
        exit.exitPosition(p);
    }

    function testRevertsWhenNoDebt() public {
        // Supply collateral but never borrow.
        collat.mint(user, 1e8);
        vm.startPrank(user);
        collat.approve(address(morpho), 1e8);
        morpho.supplyCollateral(_market(), 1e8, user, "");
        morpho.setAuthorization(address(exit), true);
        vm.stopPrank();

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(MorphoExitExecutor.NoDebt.selector);
        exit.exitPosition(p);
    }

    function testRevertsOnExpiredDeadline() public {
        _openPosition(1e8, 600e6);
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp - 1
        });

        vm.prank(user);
        vm.expectRevert(MorphoExitExecutor.DeadlineExpired.selector);
        exit.exitPosition(p);
    }

    function testRevertsOnZeroMinLoanOut() public {
        _openPosition(1e8, 600e6);
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 0,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(MorphoExitExecutor.ZeroMinLoanOut.selector);
        exit.exitPosition(p);
    }

    function testDeleverageRevertsWhenRepayExceedsDebt() public {
        _openPosition(1e8, 600e6);
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.DELEVERAGE,
            repayAssets: 700e6,
            withdrawAssets: 25000000,
            swapCollateralIn: 25000000,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoExitExecutor.RepayExceedsDebt.selector, 700e6, 600e6));
        exit.exitPosition(p);
    }

    function testDeleverageRevertsWhenWithdrawExceedsCollateral() public {
        _openPosition(1e8, 600e6);
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.DELEVERAGE,
            repayAssets: 200e6,
            withdrawAssets: 2e8,
            swapCollateralIn: 2e8,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoExitExecutor.WithdrawExceedsCollateral.selector, 2e8, 1e8));
        exit.exitPosition(p);
    }

    function testRevertsWhenSwapInputExceedsWithdrawn() public {
        _openPosition(1e8, 600e6);
        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 2e8, // more than the 1e8 collateral that will be withdrawn
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoExitExecutor.SwapInputExceedsWithdrawn.selector, 2e8, 1e8));
        exit.exitPosition(p);
    }

    function testCallbackRejectsNonMorphoCaller() public {
        vm.expectRevert(MorphoExitExecutor.OnlyMorpho.selector);
        exit.onMorphoFlashLoan(1e6, "");
    }

    function testCallbackRejectsWhenNoActiveFlash() public {
        // Impersonate Morpho directly: no flash in flight, commitment slot is empty.
        vm.prank(address(morpho));
        vm.expectRevert(MorphoExitExecutor.NoActiveFlash.selector);
        exit.onMorphoFlashLoan(1e6, hex"1234");
    }

    // ──────────────────────────── pause ────────────────────────────

    function testPausePreventsExit() public {
        _openPosition(1e8, 600e6);
        exit.pause();

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()"))));
        exit.exitPosition(p);
    }

    function testUnpauseRestoresExit() public {
        uint256 collateralAmt = 1e8;
        uint256 debtAmt = 600e6;
        _openPosition(collateralAmt, debtAmt);

        exit.pause();
        exit.unpause();

        uint256 swapOut = 1000e6;
        bytes memory swapCd = _swapCalldata(collateralAmt, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: collateralAmt,
            minLoanOut: 900e6,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt not cleared after unpause");
    }

    function testPauseNonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        exit.pause();
    }

    // ──────────────────────────── rescue ────────────────────────────

    function testRescueToken_movesTokens() public {
        uint256 stuck = 500e6;
        usdc.mint(address(exit), stuck);

        address recipient = address(0xCC);
        exit.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
        assertEq(usdc.balanceOf(address(exit)), 0);
    }

    function testRescueToken_nonOwner_reverts() public {
        usdc.mint(address(exit), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        exit.rescueToken(address(usdc), user, 100e6);
    }

    // ──────────────────────────── admin ────────────────────────────

    function testOnlyOwnerSetApprovedDex() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        exit.setApprovedDex(address(0xBEEF), true);
    }

    function testSetApprovedDex_removeDex() public {
        exit.setApprovedDex(address(dex), false);
        assertFalse(exit.isApprovedDex(address(dex)));
    }

    // ──────────────────────────── deleverage edge cases ────────────────────────────

    function testDeleverageZeroRepay_reverts() public {
        _openPosition(1e8, 600e6);

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.DELEVERAGE,
            repayAssets: 0,
            withdrawAssets: 25000000,
            swapCollateralIn: 25000000,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        // Flash loan of 0 should revert at Morpho level or produce no effect
        // The flash loan with 0 assets is a degenerate case
        vm.prank(user);
        vm.expectRevert();
        exit.exitPosition(p);
    }

    function testFullExitToCollateral_allCollateralWithdrawn() public {
        uint256 collateralAmt = 1e8;
        uint256 debtAmt = 600e6;
        _openPosition(collateralAmt, debtAmt);

        uint256 sellIn = 65000000;
        uint256 swapOut = 600e6;
        bytes memory swapCd = _swapCalldata(sellIn, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_COLLATERAL,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: sellIn,
            minLoanOut: 600e6,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (,, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, 0, "collateral should be zero after full exit");
    }

    // ──────────────────────────── selector whitelist (NM-013) ────────────────────────────

    function testRevertsWhenSwapSelectorNotApproved() public {
        _openPosition(1e8, 600e6);

        // Approved DEX, but swapRevert selector NOT whitelisted.
        bytes memory swapCalldata = abi.encodeCall(MockDex.swapRevert, ());

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: 1e8,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(MorphoExitExecutor.UnauthorizedSelector.selector, MockDex.swapRevert.selector)
        );
        exit.exitPosition(p);
    }

    function testSetApprovedSwapSelector_owner() public {
        bytes4 sel = bytes4(0x12345678);
        exit.setApprovedSwapSelector(sel, true);
        assertTrue(exit.isApprovedSwapSelector(sel));

        exit.setApprovedSwapSelector(sel, false);
        assertFalse(exit.isApprovedSwapSelector(sel));
    }

    function testSetApprovedSwapSelector_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        exit.setApprovedSwapSelector(bytes4(0x12345678), true);
    }
}
