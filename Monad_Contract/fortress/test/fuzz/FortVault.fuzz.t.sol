// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";

contract FortVaultFuzzTest is FortVaultTestBase {
    MockERC4626Vault internal erc4626;
    MockFortProtocol internal adapter;

    address internal user = address(0xA1);
    bytes32 internal key4626;
    bytes32 internal keyAdapter;

    function setUp() public override {
        super.setUp();

        erc4626 = new MockERC4626Vault(mockUsdc);
        adapter = new MockFortProtocol(address(mockUsdc));

        vault.registerProtocol("ERC4626", address(erc4626), true);
        vault.registerProtocol("Adapter", address(adapter), false);

        key4626 = keccak256(bytes("ERC4626"));
        keyAdapter = keccak256(bytes("Adapter"));
    }

    function testFuzz_deposit_amount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000e6); // 1 wei to 1B USDC
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertGt(erc4626.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function testFuzz_deposit_multiEntry(uint256 a1, uint256 a2) public {
        a1 = bound(a1, 1, 500_000_000e6);
        a2 = bound(a2, 1, 500_000_000e6);
        uint256 total = a1 + a2;
        _fundAndApprove(user, total);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](2);
        entries[0] = FortVault.DepositEntry(key4626, a1, 0, "");
        entries[1] = FortVault.DepositEntry(keyAdapter, a2, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertEq(mockUsdc.balanceOf(address(vault)), 0, "Vault balance should be 0");
    }

    function testFuzz_depositWithdraw_roundtrip(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000e6);
        _fundAndApprove(user, amount);

        // Deposit
        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(key4626, amount, 0, "");
        vm.prank(user);
        vault.deposit(dEntries);

        // Withdraw
        uint256 shares = erc4626.balanceOf(user);
        vm.prank(user);
        erc4626.approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory wEntries = new FortVault.WithdrawEntry[](1);
        wEntries[0] = FortVault.WithdrawEntry(key4626, shares, 0, "");
        vm.prank(user);
        vault.withdraw(wEntries);

        assertEq(mockUsdc.balanceOf(user), amount, "Should get exact USDC back (1:1 mock)");
        assertEq(erc4626.balanceOf(user), 0);
    }

    function testFuzz_rebalance_valuePreservation(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000e6);
        _fundAndApprove(user, amount);

        // Deposit to adapter
        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(keyAdapter, amount, 0, "");
        vm.prank(user);
        vault.deposit(dEntries);

        // Rebalance adapter -> erc4626
        FortVault.RebalanceEntry[] memory rEntries = new FortVault.RebalanceEntry[](1);
        rEntries[0] = FortVault.RebalanceEntry(keyAdapter, key4626, amount, 0, 0, "", "");
        vm.prank(user);
        vault.rebalance(rEntries);

        // Verify no value lost (1:1 mocks)
        uint256 erc4626Value = erc4626.convertToAssets(erc4626.balanceOf(user));
        assertEq(erc4626Value, amount, "Value should be preserved");
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }
}
