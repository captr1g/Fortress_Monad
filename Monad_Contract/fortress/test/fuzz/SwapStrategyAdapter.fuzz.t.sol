// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockDex.sol";

contract SwapStrategyAdapterFuzzTest is Test {
    SwapStrategyAdapter internal adapter;
    MockDex internal dex;
    MockUSDC internal usdc;
    MockERC20 internal yoUSD;

    address internal owner;
    address internal executorAddr = address(0xE);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);
        dex = new MockDex();

        SwapStrategyAdapter impl = new SwapStrategyAdapter();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(SwapStrategyAdapter.initialize, (executorAddr, owner))
        );
        adapter = SwapStrategyAdapter(address(proxy));
        adapter.setApprovedDex(address(dex), true);
        adapter.setApprovedSwapSelector(MockDex.swapExact.selector, true);
    }

    function _swapData(
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut
    ) internal view returns (bytes memory) {
        bytes memory swapCalldata = abi.encodeCall(
            MockDex.swapExact,
            (
                address(usdc),
                amountIn,
                address(yoUSD),
                amountOut,
                address(adapter)
            )
        );
        return
            abi.encode(
                address(dex),
                address(yoUSD),
                minAmountOut,
                false, // useFullBalance = false
                swapCalldata
            );
    }

    /// If out >= minOut the swap succeeds and forwards out; otherwise SlippageExceeded.
    function testFuzz_slippage(
        uint256 amountIn,
        uint256 out,
        uint256 minOut
    ) public {
        amountIn = bound(amountIn, 1, 1e30);
        out = bound(out, 0, 1e40);
        minOut = bound(minOut, 1, 1e40);

        // Fund the adapter with input and the dex with output reserve.
        usdc.mint(address(adapter), amountIn);
        yoUSD.mint(address(dex), out);

        bytes memory data = _swapData(amountIn, out, minOut);

        if (out >= minOut) {
            vm.prank(executorAddr);
            (address tokenOut, uint256 received) = adapter.execute(
                IStrategyAdapter.ActionType.SWAP,
                address(usdc),
                amountIn,
                address(0),
                data
            );
            assertEq(tokenOut, address(yoUSD));
            assertEq(received, out);
            assertEq(yoUSD.balanceOf(executorAddr), out);
        } else {
            vm.prank(executorAddr);
            vm.expectRevert(
                abi.encodeWithSelector(
                    SwapStrategyAdapter.SlippageExceeded.selector,
                    out,
                    minOut
                )
            );
            adapter.execute(
                IStrategyAdapter.ActionType.SWAP,
                address(usdc),
                amountIn,
                address(0),
                data
            );
        }
    }
}
