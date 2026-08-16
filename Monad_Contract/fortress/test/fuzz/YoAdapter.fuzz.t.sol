// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/YoAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockYoVault.sol";

contract YoAdapterFuzzTest is Test {
    YoAdapter internal adapter;
    MockUSDC internal usdc;
    MockYoVault internal yoVault;

    address internal owner;
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        yoVault = new MockYoVault(usdc);

        YoAdapter impl = new YoAdapter(address(usdc), address(yoVault));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(YoAdapter.initialize, (owner, vault))
        );
        adapter = YoAdapter(address(proxy));
    }

    function testFuzz_depositRedeem_roundTrip(uint256 amt) public {
        amt = bound(amt, 1, 1e18);

        usdc.mint(vault, amt);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amt);
        adapter.depositFor(amt, user);
        vm.stopPrank();

        assertEq(yoVault.balanceOf(user), amt, "deposit mismatch");

        vm.prank(user);
        yoVault.approve(address(adapter), amt);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 out = adapter.redeemFor(amt, receiver, user);

        assertEq(out, amt, "redeem mismatch");
        assertEq(usdc.balanceOf(receiver), amt, "receiver mismatch");
        assertEq(yoVault.balanceOf(user), 0, "shares not cleared");
    }
}
