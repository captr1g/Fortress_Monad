// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockFortProtocolEx.sol";

contract FortVaultRebalanceTest is FortVaultTestBase {
    MockERC4626Vault internal erc4626A;
    MockERC4626Vault internal erc4626B;
    MockFortProtocol internal adapter;
    MockFortProtocolEx internal adapterEx;

    address internal user = address(0xA1);
    bytes32 internal keyA;
    bytes32 internal keyB;
    bytes32 internal keyAdapter;
    bytes32 internal keyAdapterEx;

    function setUp() public override {
        super.setUp();

        erc4626A = new MockERC4626Vault(mockUsdc);
        erc4626B = new MockERC4626Vault(mockUsdc);
        adapter = new MockFortProtocol(address(mockUsdc));
        adapterEx = new MockFortProtocolEx(address(mockUsdc));

        vault.registerProtocol("VaultA", address(erc4626A), true);
        vault.registerProtocol("VaultB", address(erc4626B), true);
        vault.registerProtocol("Adapter", address(adapter), false);
        vault.registerProtocol("AdapterEx", address(adapterEx), false);

        keyA = keccak256(bytes("VaultA"));
        keyB = keccak256(bytes("VaultB"));
        keyAdapter = keccak256(bytes("Adapter"));
        keyAdapterEx = keccak256(bytes("AdapterEx"));
    }

    function _depositViaVault(bytes32 key, uint256 amount) internal {
        _fundAndApprove(user, amount);
        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key, amount, 0, "");
        vm.prank(user);
        vault.deposit(entries);
    }

    function test_rebalance_erc4626ToErc4626() public {
        uint256 amount = 1000e6;
        _depositViaVault(keyA, amount);

        uint256 sharesA = erc4626A.balanceOf(user);
        vm.prank(user);
        erc4626A.approve(address(vault), sharesA);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(keyA, keyB, sharesA, 0, 0, "", "");

        vm.prank(user);
        vault.rebalance(entries);

        assertEq(erc4626A.balanceOf(user), 0);
        assertGt(erc4626B.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_rebalance_adapterToErc4626() public {
        uint256 amount = 500e6;
        _depositViaVault(keyAdapter, amount);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(keyAdapter, keyA, amount, 0, 0, "", "");

        vm.prank(user);
        vault.rebalance(entries);

        assertEq(adapter.shares(user), 0);
        assertGt(erc4626A.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_rebalance_withData() public {
        uint256 amount = 300e6;
        _depositViaVault(keyAdapterEx, amount);

        bytes memory fromData = abi.encode(uint256(1));
        bytes memory toData = abi.encode(uint256(2));

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(keyAdapterEx, keyAdapterEx, amount, 0, 0, fromData, toData);

        // Fund adapterEx so it can pay out on redeem then accept deposit
        mockUsdc.mint(address(adapterEx), amount);

        vm.prank(user);
        vault.rebalance(entries);

        assertEq(adapterEx.redeemExCallCount(), 1);
        assertEq(adapterEx.depositExCallCount(), 1);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_rebalance_multiEntry() public {
        _depositViaVault(keyA, 400e6);
        _depositViaVault(keyAdapter, 200e6);

        uint256 sharesA = erc4626A.balanceOf(user);
        vm.prank(user);
        erc4626A.approve(address(vault), sharesA);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](2);
        entries[0] = FortVault.RebalanceEntry(keyA, keyB, sharesA, 0, 0, "", "");
        entries[1] = FortVault.RebalanceEntry(keyAdapter, keyB, 200e6, 0, 0, "", "");

        vm.prank(user);
        vault.rebalance(entries);

        assertEq(erc4626A.balanceOf(user), 0);
        assertEq(adapter.shares(user), 0);
        assertGt(erc4626B.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_rebalance_unknownFrom_reverts() public {
        bytes32 badKey = keccak256(bytes("Ghost"));
        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(badKey, keyA, 100e6, 0, 0, "", "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolNotFound.selector, badKey));
        vault.rebalance(entries);
    }

    function test_rebalance_unknownTo_reverts() public {
        _depositViaVault(keyA, 100e6);
        uint256 shares = erc4626A.balanceOf(user);
        vm.prank(user);
        erc4626A.approve(address(vault), shares);

        bytes32 badKey = keccak256(bytes("Ghost"));
        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(keyA, badKey, shares, 0, 0, "", "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolNotFound.selector, badKey));
        vault.rebalance(entries);
    }

    function test_rebalance_emitsEvent() public {
        _depositViaVault(keyAdapter, 100e6);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        entries[0] = FortVault.RebalanceEntry(keyAdapter, keyA, 100e6, 0, 0, "", "");

        vm.expectEmit(true, false, false, true);
        emit FortVault.Rebalanced(user, 1);

        vm.prank(user);
        vault.rebalance(entries);
    }

    function test_rebalance_redeemSlippageExceeded_reverts() public {
        uint256 amount = 1000e6;
        _depositViaVault(keyA, amount);

        uint256 shares = erc4626A.balanceOf(user);
        vm.prank(user);
        erc4626A.approve(address(vault), shares);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        // minUsdcOut = type(uint256).max — impossible
        entries[0] = FortVault.RebalanceEntry(keyA, keyB, shares, type(uint256).max, 0, "", "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.SlippageExceeded.selector, amount, type(uint256).max));
        vault.rebalance(entries);
    }

    function test_rebalance_depositSlippageExceeded_reverts() public {
        uint256 amount = 1000e6;
        _depositViaVault(keyA, amount);

        uint256 shares = erc4626A.balanceOf(user);
        vm.prank(user);
        erc4626A.approve(address(vault), shares);

        FortVault.RebalanceEntry[] memory entries = new FortVault.RebalanceEntry[](1);
        // minSharesOut = type(uint256).max — impossible
        entries[0] = FortVault.RebalanceEntry(keyA, keyB, shares, 0, type(uint256).max, "", "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.SlippageExceeded.selector, amount, type(uint256).max));
        vault.rebalance(entries);
    }
}
