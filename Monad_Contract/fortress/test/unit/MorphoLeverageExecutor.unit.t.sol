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
import "../mocks/MockOracle.sol";

contract MorphoLeverageExecutorUnitTest is Test {
    uint256 internal constant LLTV = 915000000000000000;
    uint256 internal constant ORACLE_PRICE_1TO1 = 1e24;

    MorphoLeverageExecutor internal lev;
    MockMorphoBlue internal morpho;
    MockDex internal dex;
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
        oracle = new MockOracle(ORACLE_PRICE_1TO1);

        MorphoLeverageExecutor impl = new MorphoLeverageExecutor(address(morpho));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(MorphoLeverageExecutor.initialize, (owner)));
        lev = MorphoLeverageExecutor(address(proxy));
        lev.setApprovedDex(address(dex), true);
        lev.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        // Fund Morpho with a USDC reserve for borrows + flash loans.
        usdc.mint(address(this), 1_000_000_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1_000_000_000e6);

        // Fund the DEX with collateral so it can serve USDC → collateral swaps.
        collat.mint(address(dex), 1_000_000e18);
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

    // USDC → collateral swap calldata. `amountIn` is what the DEX pulls; `amountOut`
    // is the collateral delivered to `recipient`.
    function _swapCalldata(uint256 amountIn, uint256 amountOut, address recipient)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(MockDex.swapExact, (address(usdc), amountIn, address(collat), amountOut, recipient));
    }

    function _fundUser(uint256 amount) internal {
        usdc.mint(user, amount);
        vm.startPrank(user);
        usdc.approve(address(lev), amount);
        morpho.setAuthorization(address(lev), true);
        vm.stopPrank();
    }

    // ──────────────────────────── happy path ────────────────────────────

    function testOpen2xLeverageOpensPosition() public {
        uint256 input = 100e6; // 100 USDC equity
        uint256 flash = 100e6; // (2 - 1) * 100 → 2x
        _fundUser(input);

        uint256 swapIn = input + flash; // 200 USDC
        uint256 collatOut = 2e18; // collateral worth ~200 USDC
        bytes memory swapCalldata = _swapCalldata(swapIn, collatOut, address(lev));

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: input,
            flashAssets: flash,
            minCollateralOut: 1.9e18,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, collatOut, "collateral not supplied");
        assertEq(borrowShares, flash, "debt not opened at flash amount");

        // No dust anywhere; user spent exactly their equity.
        assertEq(usdc.balanceOf(user), 0, "user holds leftover usdc");
        assertEq(usdc.balanceOf(address(lev)), 0, "executor holds usdc dust");
        assertEq(collat.balanceOf(address(lev)), 0, "executor holds collateral dust");
    }

    function testOpen3xLeverageSizesDebtCorrectly() public {
        uint256 input = 100e6;
        uint256 flash = 200e6; // (3 - 1) * 100 → 3x
        _fundUser(input);

        uint256 swapIn = input + flash; // 300 USDC
        uint256 collatOut = 3e18;
        bytes memory swapCalldata = _swapCalldata(swapIn, collatOut, address(lev));

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: input,
            flashAssets: flash,
            minCollateralOut: 2.9e18,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares, uint128 collateral) = morpho.positionFor(_market(), user);
        assertEq(collateral, collatOut, "collateral mismatch");
        assertEq(borrowShares, flash, "3x debt mismatch");
    }

    function testReturnsSwapResidualToUser() public {
        uint256 input = 100e6;
        uint256 flash = 100e6;
        _fundUser(input);

        // DEX only consumes 190 USDC of the 200 approved → 10 USDC residual.
        uint256 collatOut = 1.9e18;
        bytes memory swapCalldata = _swapCalldata(190e6, collatOut, address(lev));

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: input,
            flashAssets: flash,
            minCollateralOut: 1.8e18,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        assertEq(usdc.balanceOf(user), 10e6, "residual not returned to user");
        assertEq(usdc.balanceOf(address(lev)), 0, "executor holds usdc dust");
    }

    // ──────────────────────────── reverts ────────────────────────────

    function testRevertsWhenDexNotApproved() public {
        _fundUser(100e6);
        MockDex rogue = new MockDex();

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 1,
            dex: address(rogue),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoLeverageExecutor.UnauthorizedDex.selector, address(rogue)));
        lev.openLeverage(p);
    }

    function testRevertsOnSlippage() public {
        _fundUser(100e6);

        // Swap returns only 1.5e18 collateral but we require at least 1.9e18.
        bytes memory swapCalldata = _swapCalldata(200e6, 1.5e18, address(lev));
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 1.9e18,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MorphoLeverageExecutor.SlippageExceeded.selector, 1.5e18, 1.9e18));
        lev.openLeverage(p);
    }

    function testRevertsOnExpiredDeadline() public {
        _fundUser(100e6);
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp - 1
        });

        vm.prank(user);
        vm.expectRevert(MorphoLeverageExecutor.DeadlineExpired.selector);
        lev.openLeverage(p);
    }

    function testRevertsOnZeroInputAssets() public {
        _fundUser(100e6);
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 0,
            flashAssets: 100e6,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(MorphoLeverageExecutor.ZeroInputAssets.selector);
        lev.openLeverage(p);
    }

    function testRevertsOnZeroFlashAssets() public {
        _fundUser(100e6);
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 0,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(MorphoLeverageExecutor.ZeroFlashAssets.selector);
        lev.openLeverage(p);
    }

    function testRevertsOnZeroMinCollateralOut() public {
        _fundUser(100e6);
        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 0,
            dex: address(dex),
            swapCalldata: "",
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(MorphoLeverageExecutor.ZeroMinCollateralOut.selector);
        lev.openLeverage(p);
    }

    function testCallbackRejectsNonMorphoCaller() public {
        vm.expectRevert(MorphoLeverageExecutor.OnlyMorpho.selector);
        lev.onMorphoFlashLoan(1e6, "");
    }

    function testCallbackRejectsWhenNoActiveFlash() public {
        vm.prank(address(morpho));
        vm.expectRevert(MorphoLeverageExecutor.NoActiveFlash.selector);
        lev.onMorphoFlashLoan(1e6, hex"1234");
    }

    // ──────────────────────────── admin ────────────────────────────

    function testOnlyOwnerSetApprovedDex() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        lev.setApprovedDex(address(0xBEEF), true);
    }

    function testPausePreventsOpen() public {
        _fundUser(100e6);
        lev.pause();

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: _swapCalldata(200e6, 2e18, address(lev)),
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()"))));
        lev.openLeverage(p);
    }

    // ──────────────────────────── rescue ────────────────────────────

    function testRescueToken_movesTokens() public {
        uint256 stuck = 500e6;
        usdc.mint(address(lev), stuck);

        address recipient = address(0xCC);
        lev.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
        assertEq(usdc.balanceOf(address(lev)), 0);
    }

    function testRescueToken_nonOwner_reverts() public {
        usdc.mint(address(lev), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        lev.rescueToken(address(usdc), user, 100e6);
    }

    // ──────────────────────────── pause extras ────────────────────────────

    function testUnpauseRestoresOpen() public {
        _fundUser(100e6);
        lev.pause();
        lev.unpause();

        uint256 swapIn = 200e6;
        uint256 collatOut = 2e18;
        bytes memory swapCalldata = _swapCalldata(swapIn, collatOut, address(lev));

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: 100e6,
            flashAssets: 100e6,
            minCollateralOut: 1.9e18,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares,) = morpho.positionFor(_market(), user);
        assertEq(borrowShares, 100e6, "position not opened after unpause");
    }

    function testPauseNonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        lev.pause();
    }

    function testSetApprovedDex_removeDex() public {
        lev.setApprovedDex(address(dex), false);
        assertFalse(lev.isApprovedDex(address(dex)));
    }

    // ──────────────────────────── selector whitelist (NM-013) ────────────────────────────

    function testRevertsWhenSwapSelectorNotApproved() public {
        uint256 input = 100e6;
        uint256 flash = 100e6;
        _fundUser(input);

        // Approved DEX, but swapRevert selector NOT whitelisted.
        bytes memory swapCalldata = abi.encodeCall(MockDex.swapRevert, ());

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor.LeverageParams({
            market: _market(),
            inputAssets: input,
            flashAssets: flash,
            minCollateralOut: 1,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(MorphoLeverageExecutor.UnauthorizedSelector.selector, MockDex.swapRevert.selector)
        );
        lev.openLeverage(p);
    }

    function testSetApprovedSwapSelector_owner() public {
        bytes4 sel = bytes4(0x12345678);
        lev.setApprovedSwapSelector(sel, true);
        assertTrue(lev.isApprovedSwapSelector(sel));

        lev.setApprovedSwapSelector(sel, false);
        assertFalse(lev.isApprovedSwapSelector(sel));
    }

    function testSetApprovedSwapSelector_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        lev.setApprovedSwapSelector(bytes4(0x12345678), true);
    }
}
