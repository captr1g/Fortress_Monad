// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/YoAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockYoVault.sol";

contract YoAdapterTest is Test {
    YoAdapter internal adapter;
    MockUSDC internal usdc;
    MockYoVault internal yoVault;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    function setUp() public {
        usdc = new MockUSDC();
        yoVault = new MockYoVault(usdc);

        YoAdapter impl = new YoAdapter(address(usdc), address(yoVault));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(YoAdapter.initialize, (owner, vault))
        );
        adapter = YoAdapter(address(proxy));
    }

    // ──── depositFor ────

    function test_depositFor() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        assertEq(yoVault.depositCallCount(), 1);
        assertEq(yoVault.balanceOf(user), amount); // 1:1 for fresh vault
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(YoAdapter.ZeroAmount.selector);
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

        assertEq(yoVault.balanceOf(user), amount1 + amount2);
        assertEq(yoVault.depositCallCount(), 2);
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

        // User approves adapter for yoUSD transfer
        vm.prank(user);
        yoVault.approve(address(adapter), amount);

        // Redeem
        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(amount, receiver, user);

        assertEq(usdcOut, amount);
        assertEq(usdc.balanceOf(receiver), amount);
        assertEq(yoVault.balanceOf(user), 0);
        assertEq(yoVault.redeemCallCount(), 1);
    }

    function test_redeemFor_insufficientLiquidity_reverts() public {
        uint256 amount = 1000e6;

        // Deposit
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // Set maxRedeem to less than shares
        yoVault.setMaxRedeem(200e6);

        vm.prank(user);
        yoVault.approve(address(adapter), amount);

        vm.prank(vault);
        vm.expectRevert(
            abi.encodeWithSelector(YoAdapter.InsufficientLiquidity.selector, 200e6, amount)
        );
        adapter.redeemFor(amount, user, user);
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
        yoVault.approve(address(adapter), redeemAmt);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(redeemAmt, receiver, user);

        assertEq(usdcOut, redeemAmt);
        assertEq(usdc.balanceOf(receiver), redeemAmt);
        assertEq(yoVault.balanceOf(user), depositAmt - redeemAmt);
    }

    function test_redeemFor_exactMaxRedeem() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // Set maxRedeem to exactly the amount
        yoVault.setMaxRedeem(amount);

        vm.prank(user);
        yoVault.approve(address(adapter), amount);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(amount, receiver, user);

        assertEq(usdcOut, amount);
        assertEq(usdc.balanceOf(receiver), amount);
    }

    function test_redeemFor_zeroShares_reverts() public {
        vm.prank(vault);
        vm.expectRevert(YoAdapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user);
    }

    // ──── depositFor edge cases ────

    function test_depositFor_noApproval_reverts() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);

        // No approval — safeTransferFrom should revert
        vm.prank(vault);
        vm.expectRevert();
        adapter.depositFor(amount, user);
    }

    function test_depositFor_adapterHoldsNothing() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // Adapter should be stateless — zero balances
        assertEq(usdc.balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
        assertEq(yoVault.balanceOf(address(adapter)), 0, "Adapter should hold zero yoUSD");
    }

    function test_depositFor_differentReceiver() public {
        uint256 amount = 500e6;
        address receiver1 = address(0xC1);
        address receiver2 = address(0xC2);

        usdc.mint(vault, amount * 2);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount * 2);
        adapter.depositFor(amount, receiver1);
        adapter.depositFor(amount, receiver2);
        vm.stopPrank();

        assertEq(yoVault.balanceOf(receiver1), amount);
        assertEq(yoVault.balanceOf(receiver2), amount);
    }

    // ──── redeemFor edge cases ────

    function test_redeemFor_differentReceiverAndOwner() public {
        uint256 amount = 1000e6;
        address shareOwner = address(0xD1);
        address receiver = address(0xD2);

        // Deposit to shareOwner
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, shareOwner);
        vm.stopPrank();

        // shareOwner approves adapter
        vm.prank(shareOwner);
        yoVault.approve(address(adapter), amount);

        // Anyone calls redeemFor — USDC goes to receiver, shares pulled from shareOwner
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(amount, receiver, shareOwner);

        assertEq(usdcOut, amount);
        assertEq(usdc.balanceOf(receiver), amount);
        assertEq(usdc.balanceOf(shareOwner), 0);
        assertEq(yoVault.balanceOf(shareOwner), 0);
    }

    function test_redeemFor_noApproval_reverts() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // No yoUSD approval — safeTransferFrom should revert
        vm.prank(vault);
        vm.expectRevert();
        adapter.redeemFor(amount, user, user);
    }

    function test_redeemFor_maxRedeemZero_reverts() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        // maxRedeem = 0 — total lockup
        yoVault.setMaxRedeem(0);

        vm.prank(user);
        yoVault.approve(address(adapter), amount);

        vm.prank(vault);
        vm.expectRevert(
            abi.encodeWithSelector(YoAdapter.InsufficientLiquidity.selector, 0, amount)
        );
        adapter.redeemFor(amount, user, user);
    }

    function test_redeemFor_adapterHoldsNothing() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        vm.prank(user);
        yoVault.approve(address(adapter), amount);

        vm.prank(vault);
        adapter.redeemFor(amount, user, user);

        assertEq(usdc.balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
        assertEq(yoVault.balanceOf(address(adapter)), 0, "Adapter should hold zero yoUSD");
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
