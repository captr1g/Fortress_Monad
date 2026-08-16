// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockDex.sol";

contract SwapStrategyAdapterUnitTest is Test {
    SwapStrategyAdapter internal adapter;
    MockDex internal dex;
    MockUSDC internal usdc; // tokenIn (6 dec)
    MockERC20 internal yoUSD; // tokenOut (18 dec)

    address internal owner;
    address internal executorAddr = address(0xE);
    address internal nonOwner = address(0xBAD);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);
        dex = new MockDex();

        SwapStrategyAdapter impl = new SwapStrategyAdapter();
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(SwapStrategyAdapter.initialize, (executorAddr, owner)));
        adapter = SwapStrategyAdapter(address(proxy));
        adapter.setApprovedDex(address(dex), true);
        adapter.setApprovedSwapSelector(MockDex.swapExact.selector, true);
        adapter.setApprovedSwapSelector(MockDex.swapRevert.selector, true);

        // Fund DEX with output reserve.
        yoUSD.mint(address(dex), 1_000_000e18);
    }

    function _ownableErr(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), who);
    }

    function _swapData(uint256 amountIn, uint256 amountOut, uint256 minAmountOut) internal view returns (bytes memory) {
        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), amountIn, address(yoUSD), amountOut, address(adapter)));
        return abi.encode(
            address(dex),
            address(yoUSD),
            minAmountOut,
            false, // useFullBalance = false (exact mode)
            swapCalldata
        );
    }

    // ──────────────────────────── happy path ────────────────────────────

    function test_swap_happyPath() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        // Executor transfers tokenIn to the adapter first.
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) =
            adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);

        assertEq(tokenOut, address(yoUSD));
        assertEq(received, amountOut);
        // Output forwarded to executor.
        assertEq(yoUSD.balanceOf(executorAddr), amountOut);
        // Approval cleared.
        assertEq(usdc.allowance(address(adapter), address(dex)), 0);
    }

    // ──────────────────────────── onlyExecutor ────────────────────────────

    function test_swap_nonExecutor_reverts() public {
        bytes memory data = _swapData(100e6, 250e18, 200e18);
        vm.prank(nonOwner);
        vm.expectRevert(SwapStrategyAdapter.OnlyExecutor.selector);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), 100e6, address(0), data);
    }

    // ──────────────────────────── UnauthorizedDex ────────────────────────────

    function test_swap_unauthorizedDex_reverts() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        // Build data pointing at a non-allowlisted dex.
        address badDex = address(0xDEAD);
        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), amountIn, address(yoUSD), 250e18, address(adapter)));
        bytes memory data = abi.encode(badDex, address(yoUSD), uint256(200e18), false, swapCalldata);

        vm.prank(executorAddr);
        vm.expectRevert(abi.encodeWithSelector(SwapStrategyAdapter.UnauthorizedDex.selector, badDex));
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }

    // ──────────────────────────── SlippageExceeded ────────────────────────────

    function test_swap_slippageExceeded_reverts() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 100e18; // dex delivers 100
        uint256 minAmountOut = 200e18; // but we require 200
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _swapData(amountIn, amountOut, minAmountOut);

        vm.prank(executorAddr);
        vm.expectRevert(abi.encodeWithSelector(SwapStrategyAdapter.SlippageExceeded.selector, amountOut, minAmountOut));
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }

    // ──────────────────────────── SwapFailed ────────────────────────────

    function test_swap_dexReverts_swapFailed() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory swapCalldata = abi.encodeCall(MockDex.swapRevert, ());
        bytes memory data = abi.encode(address(dex), address(yoUSD), uint256(1), false, swapCalldata);

        vm.prank(executorAddr);
        vm.expectRevert(SwapStrategyAdapter.SwapFailed.selector);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }

    // ──────────────────────────── UnsupportedAction ────────────────────────────

    function test_nonSwapAction_reverts() public {
        bytes memory data = _swapData(100e6, 250e18, 200e18);
        vm.prank(executorAddr);
        vm.expectRevert(SwapStrategyAdapter.UnsupportedAction.selector);
        adapter.execute(IStrategyAdapter.ActionType.SUPPLY_COLLATERAL, address(usdc), 100e6, address(0), data);
    }

    // ──────────────────────────── admin ────────────────────────────

    function test_setApprovedDex_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.setApprovedDex(address(0xDEAD), true);
    }

    function test_setExecutor_owner() public {
        address newExec = address(0xBEEF);
        adapter.setExecutor(newExec);
        assertEq(adapter.executor(), newExec);
    }

    function test_setExecutor_zero_reverts() public {
        vm.expectRevert(SwapStrategyAdapter.ZeroExecutor.selector);
        adapter.setExecutor(address(0));
    }

    function test_setExecutor_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.setExecutor(address(0xBEEF));
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.rescueToken(address(usdc), nonOwner, 100e6);
    }

    // ──────────────────────────── full balance mode ────────────────────────────

    function test_swap_fullBalanceMode_happyPath() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        usdc.mint(address(adapter), amountIn);

        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), amountIn, address(yoUSD), amountOut, address(adapter)));
        bytes memory data = abi.encode(
            address(dex),
            address(yoUSD),
            uint256(200e18),
            true, // useFullBalance = true
            swapCalldata
        );

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            0, // amount ignored in full balance mode
            address(0),
            data
        );

        assertEq(tokenOut, address(yoUSD));
        assertEq(received, amountOut);
        assertEq(yoUSD.balanceOf(executorAddr), amountOut);
    }

    function test_swap_fullBalanceMode_zeroBalance_reverts() public {
        // No tokens on adapter
        bytes memory swapCalldata =
            abi.encodeCall(MockDex.swapExact, (address(usdc), 100e6, address(yoUSD), 250e18, address(adapter)));
        bytes memory data = abi.encode(address(dex), address(yoUSD), uint256(1), true, swapCalldata);

        vm.prank(executorAddr);
        vm.expectRevert(SwapStrategyAdapter.ZeroBalance.selector);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), 0, address(0), data);
    }

    function test_swap_approvalCleanup() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);

        assertEq(usdc.allowance(address(adapter), address(dex)), 0, "approval not cleared");
    }

    // ──────────────────────────── rescue happy path ────────────────────────────

    function test_rescueToken_happyPath() public {
        uint256 stuck = 500e6;
        usdc.mint(address(adapter), stuck);

        address recipient = address(0xCC);
        adapter.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    // ──────────────────────────── pause ────────────────────────────

    function test_pause_blocksSwap() public {
        adapter.pause();

        usdc.mint(address(adapter), 100e6);
        bytes memory data = _swapData(100e6, 250e18, 200e18);

        vm.prank(executorAddr);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()"))));
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), 100e6, address(0), data);
    }

    function test_unpause_restoresSwap() public {
        adapter.pause();
        adapter.unpause();

        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) =
            adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);

        assertEq(tokenOut, address(yoUSD));
        assertEq(received, amountOut);
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.pause();
    }

    // ──────────────────────────── residual input sweep (NM-012) ────────────────────────────

    function test_swap_residualInputSweptToExecutor() public {
        uint256 amountIn = 100e6;
        uint256 extra = 50e6;
        uint256 amountOut = 250e18;
        // Seed adapter with extra input tokens (simulates partial DEX fill).
        usdc.mint(address(adapter), amountIn + extra);

        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);

        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds residual input");
        assertEq(yoUSD.balanceOf(executorAddr), amountOut, "output mismatch");
        assertEq(usdc.balanceOf(executorAddr), extra, "residual not swept to executor");
    }

    function test_swap_noResidualWhenFullyConsumed() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);

        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds input dust");
        assertEq(usdc.balanceOf(executorAddr), 0, "executor got unexpected input tokens");
        assertEq(yoUSD.balanceOf(executorAddr), amountOut, "output mismatch");
    }

    // ──────────────────────────── selector whitelist (NM-013) ────────────────────────────

    function test_swap_unauthorizedSelector_reverts() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes4 bogusSelector = bytes4(0xdeadbeef);
        bytes memory swapCalldata = abi.encodePacked(bogusSelector, abi.encode(uint256(0)));
        bytes memory data = abi.encode(address(dex), address(yoUSD), uint256(200e18), false, swapCalldata);

        vm.prank(executorAddr);
        vm.expectRevert(abi.encodeWithSelector(SwapStrategyAdapter.UnauthorizedSelector.selector, bogusSelector));
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }

    function test_swap_emptyCalldata_reverts() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory swapCalldata = hex"aabb";
        bytes memory data = abi.encode(address(dex), address(yoUSD), uint256(200e18), false, swapCalldata);

        vm.prank(executorAddr);
        vm.expectRevert(SwapStrategyAdapter.ZeroAddress.selector);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }

    function test_setApprovedSwapSelector_owner() public {
        bytes4 sel = bytes4(0x12345678);
        adapter.setApprovedSwapSelector(sel, true);
        assertTrue(adapter.isApprovedSwapSelector(sel));

        adapter.setApprovedSwapSelector(sel, false);
        assertFalse(adapter.isApprovedSwapSelector(sel));
    }

    function test_setApprovedSwapSelector_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.setApprovedSwapSelector(bytes4(0x12345678), true);
    }

    function test_swap_selectorApprovedThenRevoked() public {
        bytes4 sel = MockDex.swapExact.selector;

        uint256 amountIn = 100e6;
        uint256 amountOut = 250e18;
        usdc.mint(address(adapter), amountIn);
        bytes memory data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
        assertEq(yoUSD.balanceOf(executorAddr), amountOut);

        // Revoke the selector.
        adapter.setApprovedSwapSelector(sel, false);

        usdc.mint(address(adapter), amountIn);
        data = _swapData(amountIn, amountOut, 200e18);

        vm.prank(executorAddr);
        vm.expectRevert(abi.encodeWithSelector(SwapStrategyAdapter.UnauthorizedSelector.selector, sel));
        adapter.execute(IStrategyAdapter.ActionType.SWAP, address(usdc), amountIn, address(0), data);
    }
}
