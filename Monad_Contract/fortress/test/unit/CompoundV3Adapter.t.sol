// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/CompoundV3Adapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockComet.sol";

contract CompoundV3AdapterTest is Test {
    CompoundV3Adapter internal adapter;
    MockUSDC internal usdc;
    MockComet internal comet;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    function setUp() public {
        usdc = new MockUSDC();
        comet = new MockComet(address(usdc));

        CompoundV3Adapter impl = new CompoundV3Adapter(address(usdc), address(comet));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(CompoundV3Adapter.initialize, (owner, vault))
        );
        adapter = CompoundV3Adapter(address(proxy));
    }

    // ──── depositFor ────

    function test_depositFor() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        assertEq(comet.supplyCallCount(), 1);
        assertEq(comet.lastDst(), user);
        assertEq(comet.lastAmount(), amount);
        assertEq(comet.balances(user), amount);
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(CompoundV3Adapter.ZeroAmount.selector);
        adapter.depositFor(0, user);
    }

    function test_depositFor_multipleDeposits() public {
        uint256 amount1 = 500e6;
        uint256 amount2 = 300e6;

        usdc.mint(vault, amount1 + amount2);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount1 + amount2);

        adapter.depositFor(amount1, user);
        adapter.depositFor(amount2, user);
        vm.stopPrank();

        assertEq(comet.balances(user), amount1 + amount2);
        assertEq(comet.supplyCallCount(), 2);
    }

    // ──── redeemFor ────

    function test_redeemFor() public {
        uint256 amount = 1000e6;

        // Setup: deposit first
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // User allows adapter to withdraw from their Comet balance
        vm.prank(user);
        comet.allow(address(adapter), true);

        // Redeem
        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(amount, receiver, user);

        assertEq(usdcOut, amount);
        assertEq(usdc.balanceOf(receiver), amount);
        assertEq(comet.balances(user), 0);
        assertEq(comet.withdrawCallCount(), 1);
    }

    function test_redeemFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(CompoundV3Adapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user);
    }

    function test_redeemFor_partialRedeem() public {
        uint256 depositAmt = 1000e6;
        uint256 redeemAmt = 400e6;

        usdc.mint(vault, depositAmt);
        vm.startPrank(vault);
        usdc.approve(address(adapter), depositAmt);
        adapter.depositFor(depositAmt, user);
        vm.stopPrank();

        vm.prank(user);
        comet.allow(address(adapter), true);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(redeemAmt, receiver, user);

        assertEq(usdcOut, redeemAmt);
        assertEq(usdc.balanceOf(receiver), redeemAmt);
        assertEq(comet.balances(user), depositAmt - redeemAmt);
    }

    function test_redeemFor_notAllowed_reverts() public {
        uint256 amount = 1000e6;

        // Deposit
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // Try redeem without allow — should revert
        vm.prank(vault);
        vm.expectRevert("not allowed");
        adapter.redeemFor(amount, user, user);
    }

    // ──── rescueToken ────

    function test_rescueToken() public {
        uint256 stuck = 100e6;
        usdc.mint(address(adapter), stuck);

        address recipient = address(0xCC);
        adapter.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            user
        ));
        adapter.rescueToken(address(usdc), user, 100e6);
    }

}
