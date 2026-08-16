// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/CrossChainRouter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiBridge.sol";

contract CrossChainRouterFuzzTest is Test {
    CrossChainRouter internal router;
    MockUSDC internal usdc;
    MockLiFiBridge internal bridge;

    address internal owner;
    address internal keeper = address(0xBEEF);
    address internal user = address(0xA1);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        bridge = new MockLiFiBridge(address(usdc));

        CrossChainRouter impl = new CrossChainRouter(address(usdc), address(bridge));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CrossChainRouter.initialize, (keeper, owner))
        );
        router = CrossChainRouter(address(proxy));

        // Register bridge selectors used by MockLiFiBridge
        router.setApprovedBridgeSelector(MockLiFiBridge.bridgeTokens.selector, true);
    }

    function testFuzz_deposit_anyValidAmount(uint256 amt) public {
        amt = bound(amt, 1, 1e18);

        usdc.mint(user, amt);
        vm.prank(user);
        usdc.approve(address(router), amt);

        bytes memory lifiData = abi.encodeCall(MockLiFiBridge.bridgeTokens, (amt, 42161, user));

        vm.prank(user);
        bytes32 requestId = router.depositCrossChain(amt, 42161, lifiData, type(uint256).max);

        assertTrue(requestId != bytes32(0), "zero request id");
        assertEq(usdc.balanceOf(user), 0, "user still has usdc");
        assertEq(usdc.balanceOf(address(router)), 0, "router holds usdc");
    }

    function testFuzz_pendingWithdrawBalance_accounting(uint256 amt) public {
        amt = bound(amt, 1, 1e18);

        vm.prank(user);
        bytes32 requestId = router.initiateWithdraw(amt, 0, 42161, type(uint256).max);

        usdc.mint(address(router), amt);

        vm.prank(keeper);
        router.fulfillWithdraw(requestId, amt);

        assertEq(router.pendingWithdrawBalance(), amt, "pending mismatch");

        vm.prank(user);
        router.claimWithdraw(requestId);

        assertEq(router.pendingWithdrawBalance(), 0, "pending not cleared");
        assertEq(usdc.balanceOf(user), amt, "user balance mismatch");
    }
}
