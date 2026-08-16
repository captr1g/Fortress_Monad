// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/MorphoLeverageExecutor.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockMorphoBlue.sol";
import "../mocks/MockDex.sol";
import "../mocks/MockRateDex.sol";
import "../mocks/MockOracle.sol";

/// @notice Fuzz suite for MorphoLeverageExecutor. Foundry reverts to the post-setUp state
///         between runs, so the Morpho loan reserve funded in setUp is fresh each iteration.
///         The mock Morpho does not enforce LTV health (that is the fork test's job); these
///         fuzz tests target the executor's own invariants: exact debt sizing, slippage
///         enforcement, residual return, and zero dust across a wide input space.
contract MorphoLeverageExecutorFuzzTest is Test {
    uint256 internal constant LLTV = 915000000000000000;

    MorphoLeverageExecutor internal lev;
    MockMorphoBlue internal morpho;
    MockDex internal dex;
    MockRateDex internal rateDex;
    MockOracle internal oracle;
    MockUSDC internal usdc; // loan token (6 dec)
    MockERC20 internal collat; // collateral token (18 dec)

    address internal owner;
    address internal user = address(0xA1);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        collat = new MockERC20("Wrapped ETH", "WETH", 18);

        morpho = new MockMorphoBlue();
        dex = new MockDex();
        rateDex = new MockRateDex();
        oracle = new MockOracle(1e24);

        MorphoLeverageExecutor impl = new MorphoLeverageExecutor(address(morpho));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(MorphoLeverageExecutor.initialize, (owner)));
        lev = MorphoLeverageExecutor(address(proxy));
        lev.setApprovedDex(address(dex), true);
        lev.setApprovedDex(address(rateDex), true);
        lev.setApprovedSwapSelector(MockDex.swapExact.selector, true);
        lev.setApprovedSwapSelector(MockRateDex.swapAtRate.selector, true);

        // Deep loan reserve to serve both the flash loan and the borrow within a tx.
        usdc.mint(address(this), 1e33);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1e33);
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

    function _fundUser(uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(lev), amount);
        morpho.setAuthorization(address(lev), true);
        vm.stopPrank();
    }

    // ── Slippage: swap output ≥ floor succeeds and sizes debt to flash; otherwise reverts. ──
    function testFuzz_slippageEnforced(uint256 inputAssets, uint256 flashAssets, uint256 collatOut, uint256 minOut)
        public
    {
        inputAssets = bound(inputAssets, 1, 1e27);
        flashAssets = bound(flashAssets, 1, 1e27);
        collatOut = bound(collatOut, 0, 1e30);
        minOut = bound(minOut, 1, 1e30);

        uint256 swapIn = inputAssets + flashAssets;
        _fundUser(inputAssets);
        collat.mint(address(dex), collatOut);

        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), swapIn, address(collat), collatOut, address(lev)));
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: inputAssets,
            flashAssets: flashAssets,
            minCollateralOut: minOut,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        if (collatOut >= minOut) {
            vm.prank(user);
            lev.openLeverage(p);

            (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
            assertEq(collateral, collatOut, "collateral != swap output");
            assertEq(borrowShares, flashAssets, "debt != flash amount");
            assertEq(usdc.balanceOf(address(lev)), 0, "loan dust on executor");
            assertEq(collat.balanceOf(address(lev)), 0, "collateral dust on executor");
            assertEq(usdc.balanceOf(user), 0, "unexpected user residual");
        } else {
            vm.prank(user);
            vm.expectRevert(abi.encodeWithSelector(MorphoLeverageExecutor.SlippageExceeded.selector, collatOut, minOut));
            lev.openLeverage(p);
        }
    }

    // ── Debt always equals the flash amount, independent of the swap output size. ──
    function testFuzz_debtAlwaysEqualsFlash(uint256 inputAssets, uint256 flashAssets, uint256 collatOut) public {
        inputAssets = bound(inputAssets, 1, 1e27);
        flashAssets = bound(flashAssets, 1, 1e27);
        collatOut = bound(collatOut, 1, 1e30);

        uint256 swapIn = inputAssets + flashAssets;
        _fundUser(inputAssets);
        collat.mint(address(dex), collatOut);

        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), swapIn, address(collat), collatOut, address(lev)));
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: inputAssets,
            flashAssets: flashAssets,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, flashAssets, "debt must equal flash exactly");
        assertEq(collateral, collatOut, "collateral must equal swap output");
    }

    // ── Any loan tokens the swap does not consume are returned to the user, never stranded. ──
    function testFuzz_residualReturnedToUser(uint256 inputAssets, uint256 flashAssets, uint256 consumed) public {
        inputAssets = bound(inputAssets, 1, 1e27);
        flashAssets = bound(flashAssets, 1, 1e27);
        uint256 swapIn = inputAssets + flashAssets;
        consumed = bound(consumed, 1, swapIn);

        uint256 collatOut = 1e18;
        _fundUser(inputAssets);
        collat.mint(address(dex), collatOut);

        // The DEX pulls only `consumed`, leaving swapIn - consumed on the executor.
        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), consumed, address(collat), collatOut, address(lev)));
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: inputAssets,
            flashAssets: flashAssets,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        uint256 residual = swapIn - consumed;
        assertEq(usdc.balanceOf(user), residual, "residual not returned");
        assertEq(usdc.balanceOf(address(lev)), 0, "loan dust on executor");
        assertEq(collat.balanceOf(address(lev)), 0, "collateral dust on executor");

        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, flashAssets, "debt must equal flash exactly");
    }

    // ── Full input is swapped at any price; position is consistent and leaves zero dust. ──
    function testFuzz_rateSwapConsistent(uint256 inputAssets, uint256 flashAssets, uint256 rate) public {
        inputAssets = bound(inputAssets, 1e6, 1e27);
        flashAssets = bound(flashAssets, 1e6, 1e27);
        rate = bound(rate, 1e15, 1e24);

        uint256 swapIn = inputAssets + flashAssets;
        uint256 expectedCollat = (swapIn * rate) / 1e18;
        vm.assume(expectedCollat > 0 && expectedCollat <= type(uint128).max);

        _fundUser(inputAssets);
        collat.mint(address(rateDex), expectedCollat);

        bytes memory swapCalldata =
            abi.encodeCall(MockRateDex.swapAtRate, (address(usdc), swapIn, address(collat), rate, address(lev)));
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: inputAssets,
            flashAssets: flashAssets,
            minCollateralOut: expectedCollat,
            dex: address(rateDex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, expectedCollat, "collateral != priced swap output");
        assertEq(borrowShares, flashAssets, "debt != flash amount");
        assertEq(usdc.balanceOf(user), 0, "unexpected user residual");
        assertEq(usdc.balanceOf(address(lev)), 0, "loan dust on executor");
        assertEq(collat.balanceOf(address(lev)), 0, "collateral dust on executor");
    }
}
