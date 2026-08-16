// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/CompoundV3Adapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockComet.sol";

contract CompoundV3AdapterFuzzTest is Test {
    CompoundV3Adapter internal adapter;
    MockUSDC internal usdc;
    MockComet internal comet;

    address internal owner;
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        comet = new MockComet(address(usdc));

        CompoundV3Adapter impl = new CompoundV3Adapter(address(usdc), address(comet));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CompoundV3Adapter.initialize, (owner, vault))
        );
        adapter = CompoundV3Adapter(address(proxy));
    }

    function testFuzz_depositRedeem_roundTrip(uint256 amt) public {
        amt = bound(amt, 1, 1e18);

        usdc.mint(vault, amt);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amt);
        adapter.depositFor(amt, user);
        vm.stopPrank();

        assertEq(comet.balances(user), amt, "deposit mismatch");

        vm.prank(user);
        comet.allow(address(adapter), true);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 out = adapter.redeemFor(amt, receiver, user);

        assertGe(out, 0, "redeem nonzero");
        assertEq(usdc.balanceOf(receiver), amt, "receiver mismatch");
        assertEq(comet.balances(user), 0, "balance not cleared");
    }
}
