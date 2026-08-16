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

contract MorphoExitExecutorFuzzTest is Test {
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

        usdc.mint(address(this), 1e33);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1e33);
        usdc.mint(address(dex), 1e33);
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

    function _openPosition(uint256 collateralAmt, uint256 debtAmt) internal {
        collat.mint(user, collateralAmt);
        vm.startPrank(user);
        collat.approve(address(morpho), collateralAmt);
        morpho.supplyCollateral(_market(), collateralAmt, user, "");
        morpho.borrow(_market(), debtAmt, 0, user, user);
        morpho.setAuthorization(address(exit), true);
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

    function testFuzz_fullExitToLoan_debtCleared(uint256 collateralAmt, uint256 debtAmt) public {
        collateralAmt = bound(collateralAmt, 1e4, 1e12);
        debtAmt = bound(debtAmt, 1, collateralAmt); // debt <= collateral value

        _openPosition(collateralAmt, debtAmt);

        uint256 swapOut = debtAmt + 1; // enough to repay + 1 surplus
        bytes memory swapCd = _swapCalldata(collateralAmt, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: collateralAmt,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 0, "debt not cleared");
    }

    function testFuzz_fullExitToCollateral_positionCleared(uint256 collateralAmt, uint256 debtAmt) public {
        collateralAmt = bound(collateralAmt, 1e4, 1e12);
        debtAmt = bound(debtAmt, 1, collateralAmt);

        _openPosition(collateralAmt, debtAmt);

        uint256 sellIn = collateralAmt / 2 > 0 ? collateralAmt / 2 : 1;
        uint256 swapOut = debtAmt; // exactly enough to repay
        bytes memory swapCd = _swapCalldata(sellIn, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_COLLATERAL,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: sellIn,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (,, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, 0, "collateral not cleared from morpho");
    }

    function testFuzz_deleverage_debtReduces(uint256 collateralAmt, uint256 debtAmt, uint256 repayFraction) public {
        collateralAmt = bound(collateralAmt, 1e6, 1e12);
        debtAmt = bound(debtAmt, 2, collateralAmt);
        repayFraction = bound(repayFraction, 1, debtAmt - 1);

        _openPosition(collateralAmt, debtAmt);

        uint256 withdrawAmt = collateralAmt / 4 > 0 ? collateralAmt / 4 : 1;
        uint256 swapOut = repayFraction + 1; // enough for repay + surplus
        bytes memory swapCd = _swapCalldata(withdrawAmt, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.DELEVERAGE,
            repayAssets: repayFraction,
            withdrawAssets: withdrawAmt,
            swapCollateralIn: withdrawAmt,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 postBorrow,) = morpho.positionFor(_market(), user);
        assertLt(postBorrow, debtAmt, "debt did not decrease");
    }

    function testFuzz_exit_noTokensStuck(uint256 collateralAmt, uint256 debtAmt) public {
        collateralAmt = bound(collateralAmt, 1e4, 1e12);
        debtAmt = bound(debtAmt, 1, collateralAmt);

        _openPosition(collateralAmt, debtAmt);

        uint256 swapOut = debtAmt + 1;
        bytes memory swapCd = _swapCalldata(collateralAmt, swapOut, address(exit));

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: _market(),
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: collateralAmt,
            minLoanOut: 1,
            dex: address(dex),
            swapCalldata: swapCd,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        assertEq(usdc.balanceOf(address(exit)), 0, "executor holds usdc dust");
        assertEq(collat.balanceOf(address(exit)), 0, "executor holds collateral dust");
    }
}
