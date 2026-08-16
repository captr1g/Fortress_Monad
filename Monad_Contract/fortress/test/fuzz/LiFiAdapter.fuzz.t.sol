// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";

contract LiFiAdapterFuzzTest is Test {
    LiFiAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal diamond;

    address internal caller = address(0xBA);
    address internal receiver = address(0xA1);

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6); // 1:1

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (address(this), caller)));
        adapter = LiFiAdapter(address(proxy));
        adapter.setApprovedDex(address(diamond), true);
    }

    uint256 internal constant DEADLINE = type(uint256).max;

    function testFuzz_depositFor_amountOverride(uint256 vaultAmount, uint256 userAmount) public {
        vaultAmount = bound(vaultAmount, 1, 1_000_000_000e6);
        userAmount = bound(userAmount, 1, 1_000_000_000e6);

        // Build swap data with userAmount (should be overridden)
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: userAmount,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(address(diamond), vaultAmount);
        usdc.mint(caller, vaultAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), vaultAmount);
        bytes memory data = abi.encode(swaps, uint256(0), DEADLINE);
        adapter.depositFor(vaultAmount, receiver, data);
        vm.stopPrank();

        // Diamond got vaultAmount regardless of userAmount
        assertEq(usdc.balanceOf(address(diamond)), vaultAmount);
        assertEq(weth.balanceOf(receiver), vaultAmount);
    }

    function testFuzz_slippage(uint256 amount, uint256 rate) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        rate = bound(rate, 500_000, 2_000_000); // 0.5x to 2x

        diamond.setRate(rate);
        uint256 expectedOut = (amount * rate) / 1e6;
        uint256 minOut = (amount * 900_000) / 1e6; // 90% of input as min

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: amount,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(address(diamond), expectedOut);
        usdc.mint(caller, amount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), amount);
        bytes memory data = abi.encode(swaps, minOut, DEADLINE);

        if (expectedOut < minOut) {
            vm.expectRevert("slippage");
        }
        adapter.depositFor(amount, receiver, data);
        vm.stopPrank();

        if (expectedOut >= minOut) {
            assertEq(weth.balanceOf(receiver), expectedOut);
        }
    }

    // ──── swap() fuzz tests ────

    function testFuzz_swap_amountOverride(uint256 userAmount, uint256 calldataAmount) public {
        userAmount = bound(userAmount, 1, 1_000_000_000e6);
        calldataAmount = bound(calldataAmount, 1, 1_000_000_000e6);

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: calldataAmount,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(address(diamond), userAmount);
        usdc.mint(caller, userAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), userAmount);
        adapter.swap(address(usdc), userAmount, address(weth), 0, DEADLINE, swaps);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(diamond)), userAmount, "diamond got userAmount");
        assertEq(weth.balanceOf(caller), userAmount, "caller got output");
    }

    function testFuzz_swap_slippage(uint256 inputAmount, uint256 rate) public {
        inputAmount = bound(inputAmount, 1e6, 1_000_000e6);
        rate = bound(rate, 500_000, 2_000_000);

        diamond.setRate(rate);
        uint256 expectedOut = (inputAmount * rate) / 1e6;
        uint256 minOut = (inputAmount * 900_000) / 1e6;

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: inputAmount,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(address(diamond), expectedOut);
        usdc.mint(caller, inputAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), inputAmount);

        if (expectedOut < minOut) {
            vm.expectRevert("slippage");
        }
        adapter.swap(address(usdc), inputAmount, address(weth), minOut, DEADLINE, swaps);
        vm.stopPrank();

        if (expectedOut >= minOut) {
            assertEq(weth.balanceOf(caller), expectedOut);
        }
    }

    function testFuzz_swap_noStuckTokens(uint256 inputAmount) public {
        inputAmount = bound(inputAmount, 1, 1_000_000_000e6);

        weth.mint(address(diamond), inputAmount);
        usdc.mint(caller, inputAmount);

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: inputAmount,
            callData: "",
            requiresDeposit: true
        });

        vm.startPrank(caller);
        usdc.approve(address(adapter), inputAmount);
        adapter.swap(address(usdc), inputAmount, address(weth), 0, DEADLINE, swaps);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(adapter)), 0, "no stuck input");
        assertEq(weth.balanceOf(address(adapter)), 0, "no stuck output");
    }
}
