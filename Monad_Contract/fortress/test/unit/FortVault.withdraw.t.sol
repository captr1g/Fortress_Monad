// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockFortProtocolEx.sol";

contract FortVaultWithdrawTest is FortVaultTestBase {
    MockERC4626Vault internal erc4626;
    MockFortProtocol internal adapter;
    MockFortProtocolEx internal adapterEx;

    address internal user = address(0xA1);
    bytes32 internal key4626;
    bytes32 internal keyAdapter;
    bytes32 internal keyAdapterEx;

    function setUp() public override {
        super.setUp();

        erc4626 = new MockERC4626Vault(mockUsdc);
        adapter = new MockFortProtocol(address(mockUsdc));
        adapterEx = new MockFortProtocolEx(address(mockUsdc));

        vault.registerProtocol("ERC4626", address(erc4626), true);
        vault.registerProtocol("Adapter", address(adapter), false);
        vault.registerProtocol("AdapterEx", address(adapterEx), false);

        key4626 = keccak256(bytes("ERC4626"));
        keyAdapter = keccak256(bytes("Adapter"));
        keyAdapterEx = keccak256(bytes("AdapterEx"));
    }

    /// @dev Helper: deposit first so user has shares to withdraw
    function _depositViaVault(bytes32 key, uint256 amount) internal {
        _fundAndApprove(user, amount);
        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key, amount, 0, "");
        vm.prank(user);
        vault.deposit(entries);
    }

    function test_withdraw_singleERC4626() public {
        uint256 amount = 1000e6;
        _depositViaVault(key4626, amount);

        uint256 shares = erc4626.balanceOf(user);
        assertGt(shares, 0);

        // User approves vault to pull shares
        vm.prank(user);
        erc4626.approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(key4626, shares, 0, "");

        vm.prank(user);
        vault.withdraw(entries);

        assertEq(erc4626.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(user), amount); // got USDC back
    }

    function test_withdraw_singleAdapter() public {
        uint256 amount = 500e6;
        _depositViaVault(keyAdapter, amount);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(keyAdapter, amount, 0, "");

        vm.prank(user);
        vault.withdraw(entries);

        assertEq(adapter.redeemCallCount(), 1);
        assertEq(adapter.lastReceiver(), user);
        assertEq(adapter.shares(user), 0);
    }

    function test_withdraw_adapterWithData() public {
        uint256 amount = 750e6;
        _depositViaVault(keyAdapterEx, amount);

        bytes memory testData = abi.encode(uint256(99));

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(keyAdapterEx, amount, 0, testData);

        vm.prank(user);
        vault.withdraw(entries);

        assertEq(adapterEx.redeemExCallCount(), 1);
        assertEq(adapterEx.lastData(), testData);
        assertEq(adapterEx.shares(user), 0);
    }

    function test_withdraw_multiProtocol() public {
        _depositViaVault(key4626, 300e6);
        _depositViaVault(keyAdapter, 200e6);

        uint256 shares4626 = erc4626.balanceOf(user);
        vm.prank(user);
        erc4626.approve(address(vault), shares4626);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](2);
        entries[0] = FortVault.WithdrawEntry(key4626, shares4626, 0, "");
        entries[1] = FortVault.WithdrawEntry(keyAdapter, 200e6, 0, "");

        vm.prank(user);
        vault.withdraw(entries);

        assertEq(erc4626.balanceOf(user), 0);
        assertEq(adapter.shares(user), 0);
        assertEq(mockUsdc.balanceOf(user), 500e6);
    }

    function test_withdraw_unknownProtocol_reverts() public {
        bytes32 badKey = keccak256(bytes("Ghost"));
        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(badKey, 100e6, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolNotFound.selector, badKey));
        vault.withdraw(entries);
    }

    function test_withdraw_whenPaused_reverts() public {
        vault.pause();

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(key4626, 100e6, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.withdraw(entries);
    }

    function test_withdraw_emitsEvent() public {
        _depositViaVault(keyAdapter, 100e6);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(keyAdapter, 100e6, 0, "");

        vm.expectEmit(true, false, false, true);
        emit FortVault.Withdrawn(user, 1);

        vm.prank(user);
        vault.withdraw(entries);
    }

    function test_withdraw_slippageExceeded_reverts() public {
        uint256 amount = 1000e6;
        _depositViaVault(key4626, amount);

        uint256 shares = erc4626.balanceOf(user);
        vm.prank(user);
        erc4626.approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        // minUsdcOut = type(uint256).max — impossible to satisfy
        entries[0] = FortVault.WithdrawEntry(key4626, shares, type(uint256).max, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.SlippageExceeded.selector, amount, type(uint256).max));
        vault.withdraw(entries);
    }

    function test_withdraw_slippageZero_noCheck() public {
        uint256 amount = 1000e6;
        _depositViaVault(key4626, amount);

        uint256 shares = erc4626.balanceOf(user);
        vm.prank(user);
        erc4626.approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](1);
        entries[0] = FortVault.WithdrawEntry(key4626, shares, 0, "");

        vm.prank(user);
        vault.withdraw(entries);

        assertEq(mockUsdc.balanceOf(user), amount);
    }
}
