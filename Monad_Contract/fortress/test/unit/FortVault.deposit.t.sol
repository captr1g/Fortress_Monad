// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockFortProtocolEx.sol";

contract FortVaultDepositTest is FortVaultTestBase {
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

    function test_deposit_singleERC4626() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        // User should have vault shares
        assertGt(erc4626.balanceOf(user), 0);
        // Vault should hold zero USDC
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_singleAdapter() public {
        uint256 amount = 500e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(keyAdapter, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertEq(adapter.depositCallCount(), 1);
        assertEq(adapter.lastReceiver(), user);
        assertEq(adapter.lastAmount(), amount);
        assertEq(adapter.shares(user), amount);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_adapterWithData() public {
        uint256 amount = 750e6;
        _fundAndApprove(user, amount);

        bytes memory testData = abi.encode(uint256(42), address(0xDEAD));

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(keyAdapterEx, amount, 0, testData);

        vm.prank(user);
        vault.deposit(entries);

        assertEq(adapterEx.depositExCallCount(), 1);
        assertEq(adapterEx.lastReceiver(), user);
        assertEq(adapterEx.lastAmount(), amount);
        assertEq(adapterEx.lastData(), testData);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_multiProtocol() public {
        uint256 a1 = 300e6;
        uint256 a2 = 200e6;
        uint256 total = a1 + a2;
        _fundAndApprove(user, total);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](2);
        entries[0] = FortVault.DepositEntry(key4626, a1, 0, "");
        entries[1] = FortVault.DepositEntry(keyAdapter, a2, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertGt(erc4626.balanceOf(user), 0);
        assertEq(adapter.shares(user), a2);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_zeroAmount_reverts() public {
        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, 0, 0, "");

        vm.prank(user);
        vm.expectRevert(FortVault.ZeroAmount.selector);
        vault.deposit(entries);
    }

    function test_deposit_unknownProtocol_reverts() public {
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        bytes32 badKey = keccak256(bytes("Unknown"));
        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(badKey, amount, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolNotFound.selector, badKey));
        vault.deposit(entries);
    }

    function test_deposit_whenPaused_reverts() public {
        vault.pause();

        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        vault.deposit(entries);
    }

    function test_deposit_emitsEvent() public {
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.expectEmit(true, false, false, true);
        emit FortVault.Deposited(user, amount, 1);

        vm.prank(user);
        vault.deposit(entries);
    }

    function test_deposit_slippageExceeded_reverts() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        // minSharesOut = type(uint256).max — impossible to satisfy
        entries[0] = FortVault.DepositEntry(key4626, amount, type(uint256).max, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.SlippageExceeded.selector, amount, type(uint256).max));
        vault.deposit(entries);
    }

    function test_deposit_slippageZero_noCheck() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertGt(erc4626.balanceOf(user), 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4 (Monad): ERC-4626 capacity guard.
    //
    // Every sizeable MetaMorpho V2 USDC vault on Monad currently reports
    // maxDeposit() == 0 (at cap, not gated). Without the guard the vault's own
    // revert bubbles up anonymously AND takes the whole multi-protocol deposit
    // with it, so the user cannot tell which entry was at fault.
    // ─────────────────────────────────────────────────────────────────────────

    function test_deposit_cappedERC4626_revertsWithAttributableError() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        erc4626.setMaxDeposit(0); // simulate a vault at cap

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolAtCapacity.selector, key4626, amount, 0));
        vault.deposit(entries);
    }

    function test_deposit_partialCapacity_revertsRatherThanUnderDepositing() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        erc4626.setMaxDeposit(400e6); // room for less than requested

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        // Must NOT silently deposit only what fits — that would under-deposit the
        // user's funds and break the exact-sum property (I12).
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolAtCapacity.selector, key4626, amount, 400e6));
        vault.deposit(entries);
    }

    function test_deposit_cappedVault_namesTheOffendingEntry_inMultiProtocolBatch() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        erc4626.setMaxDeposit(0);

        // Split across a healthy adapter and the capped vault. The error must
        // identify the capped one specifically.
        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](2);
        entries[0] = FortVault.DepositEntry(keyAdapter, 500e6, 0, "");
        entries[1] = FortVault.DepositEntry(key4626, 500e6, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolAtCapacity.selector, key4626, 500e6, 0));
        vault.deposit(entries);
    }

    function test_deposit_uncappedVault_unaffectedByGuard() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        assertGt(erc4626.balanceOf(user), 0, "shares should reach the user");
    }
}
