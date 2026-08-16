// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";

contract FortVaultDepositFeeTest is FortVaultTestBase {
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

    /// @dev Helper: queue fee, warp past delay, execute
    function _setFeeViaTimelock(uint16 feeBps) internal {
        vault.queueDepositFeeBps(feeBps);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);
        vault.executeDepositFeeBps();
    }

    // ══════════════════════════════════════════════════════════════
    //                    QUEUE DEPOSIT FEE
    // ══════════════════════════════════════════════════════════════

    function test_queueDepositFeeBps_setsExecuteAfter() public {
        uint48 delay = vault.feeTimelockDelay();
        uint48 expectedAfter = uint48(block.timestamp) + delay;

        vault.queueDepositFeeBps(200);

        (uint16 newFeeBps, uint48 executeAfter) = vault.pendingFeeChange();
        assertEq(newFeeBps, 200);
        assertEq(executeAfter, expectedAfter);
    }

    function test_queueDepositFeeBps_emitsEvent() public {
        uint48 delay = vault.feeTimelockDelay();
        uint48 expectedAfter = uint48(block.timestamp) + delay;

        vm.expectEmit(false, false, false, true);
        emit FortVault.DepositFeeChangeQueued(200, expectedAfter);
        vault.queueDepositFeeBps(200);
    }

    function test_queueDepositFeeBps_tooHigh_reverts() public {
        vm.expectRevert(FortVault.FeeTooHigh.selector);
        vault.queueDepositFeeBps(501);
    }

    function test_queueDepositFeeBps_alreadyQueued_reverts() public {
        vault.queueDepositFeeBps(200);

        vm.expectRevert(FortVault.FeeChangeAlreadyQueued.selector);
        vault.queueDepositFeeBps(300);
    }

    function test_queueDepositFeeBps_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        vault.queueDepositFeeBps(100);
    }

    function test_queueDepositFeeBps_maxFee() public {
        vault.queueDepositFeeBps(500);
        (uint16 newFeeBps,) = vault.pendingFeeChange();
        assertEq(newFeeBps, 500);
    }

    // ══════════════════════════════════════════════════════════════
    //                    EXECUTE DEPOSIT FEE
    // ══════════════════════════════════════════════════════════════

    function test_executeDepositFeeBps_appliesFee() public {
        vault.queueDepositFeeBps(200);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);

        vault.executeDepositFeeBps();
        assertEq(vault.depositFeeBps(), 200);
    }

    function test_executeDepositFeeBps_clearsPending() public {
        vault.queueDepositFeeBps(200);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);
        vault.executeDepositFeeBps();

        (uint16 newFeeBps, uint48 executeAfter) = vault.pendingFeeChange();
        assertEq(newFeeBps, 0);
        assertEq(executeAfter, 0);
    }

    function test_executeDepositFeeBps_emitsEvent() public {
        vault.queueDepositFeeBps(200);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);

        vm.expectEmit(false, false, false, true);
        emit FortVault.DepositFeeUpdated(0, 200);
        vault.executeDepositFeeBps();
    }

    function test_executeDepositFeeBps_beforeDelay_reverts() public {
        vault.queueDepositFeeBps(200);
        // don't warp
        (, uint48 executeAfter) = vault.pendingFeeChange();
        vm.expectRevert(abi.encodeWithSelector(FortVault.FeeChangeNotReady.selector, executeAfter));
        vault.executeDepositFeeBps();
    }

    function test_executeDepositFeeBps_afterExpiry_reverts() public {
        vault.queueDepositFeeBps(200);
        (, uint48 executeAfter) = vault.pendingFeeChange();
        // warp past executeAfter + 48 hours
        vm.warp(executeAfter + 48 hours + 1);

        vm.expectRevert(FortVault.FeeChangeExpired.selector);
        vault.executeDepositFeeBps();
    }

    function test_executeDepositFeeBps_noPending_reverts() public {
        vm.expectRevert(FortVault.NoFeeChangeQueued.selector);
        vault.executeDepositFeeBps();
    }

    function test_executeDepositFeeBps_nonOwner_reverts() public {
        vault.queueDepositFeeBps(200);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);

        vm.prank(user);
        vm.expectRevert();
        vault.executeDepositFeeBps();
    }

    function test_executeDepositFeeBps_exactlyAtExecuteAfter() public {
        vault.queueDepositFeeBps(200);
        (, uint48 executeAfter) = vault.pendingFeeChange();
        vm.warp(executeAfter);

        vault.executeDepositFeeBps();
        assertEq(vault.depositFeeBps(), 200);
    }

    function test_executeDepositFeeBps_atExpiryBoundary() public {
        vault.queueDepositFeeBps(200);
        (, uint48 executeAfter) = vault.pendingFeeChange();
        // exactly at expiry boundary — still valid
        vm.warp(executeAfter + 48 hours);

        vault.executeDepositFeeBps();
        assertEq(vault.depositFeeBps(), 200);
    }

    // ══════════════════════════════════════════════════════════════
    //                    CANCEL DEPOSIT FEE
    // ══════════════════════════════════════════════════════════════

    function test_cancelDepositFeeBps_clearsPending() public {
        vault.queueDepositFeeBps(200);
        vault.cancelDepositFeeBps();

        (uint16 newFeeBps, uint48 executeAfter) = vault.pendingFeeChange();
        assertEq(newFeeBps, 0);
        assertEq(executeAfter, 0);
    }

    function test_cancelDepositFeeBps_emitsEvent() public {
        vault.queueDepositFeeBps(200);

        vm.expectEmit(false, false, false, true);
        emit FortVault.DepositFeeChangeCancelled(200);
        vault.cancelDepositFeeBps();
    }

    function test_cancelDepositFeeBps_noPending_reverts() public {
        vm.expectRevert(FortVault.NoFeeChangeQueued.selector);
        vault.cancelDepositFeeBps();
    }

    function test_cancelDepositFeeBps_nonOwner_reverts() public {
        vault.queueDepositFeeBps(200);

        vm.prank(user);
        vm.expectRevert();
        vault.cancelDepositFeeBps();
    }

    function test_cancelDepositFeeBps_thenQueueNew() public {
        vault.queueDepositFeeBps(200);
        vault.cancelDepositFeeBps();

        // can queue again after cancel
        vault.queueDepositFeeBps(300);
        (uint16 newFeeBps,) = vault.pendingFeeChange();
        assertEq(newFeeBps, 300);
    }

    // ══════════════════════════════════════════════════════════════
    //                    SET FEE TIMELOCK DELAY
    // ══════════════════════════════════════════════════════════════

    function test_setFeeTimelockDelay_withinBounds() public {
        vault.setFeeTimelockDelay(24 hours);
        assertEq(vault.feeTimelockDelay(), 24 hours);
    }

    function test_setFeeTimelockDelay_minBound() public {
        vault.setFeeTimelockDelay(12 hours);
        assertEq(vault.feeTimelockDelay(), 12 hours);
    }

    function test_setFeeTimelockDelay_maxBound() public {
        vault.setFeeTimelockDelay(7 days);
        assertEq(vault.feeTimelockDelay(), 7 days);
    }

    function test_setFeeTimelockDelay_belowMin_reverts() public {
        vm.expectRevert(FortVault.InvalidTimelockDelay.selector);
        vault.setFeeTimelockDelay(12 hours - 1);
    }

    function test_setFeeTimelockDelay_aboveMax_reverts() public {
        vm.expectRevert(FortVault.InvalidTimelockDelay.selector);
        vault.setFeeTimelockDelay(7 days + 1);
    }

    function test_setFeeTimelockDelay_emitsEvent() public {
        uint48 oldDelay = vault.feeTimelockDelay();
        vm.expectEmit(false, false, false, true);
        emit FortVault.FeeTimelockDelayUpdated(oldDelay, 24 hours);
        vault.setFeeTimelockDelay(24 hours);
    }

    function test_setFeeTimelockDelay_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        vault.setFeeTimelockDelay(24 hours);
    }

    function test_defaultFeeTimelockDelay() public view {
        assertEq(vault.feeTimelockDelay(), 48 hours);
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT WITH FEE (unchanged logic)
    // ══════════════════════════════════════════════════════════════

    function test_deposit_withFee_singleEntry() public {
        _setFeeViaTimelock(200); // 2%

        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        vault.deposit(entries);

        uint256 expectedFee = (amount * 200) / 10000; // 20 USDC
        uint256 expectedNet = amount - expectedFee; // 980 USDC

        assertEq(mockUsdc.balanceOf(owner) - ownerBefore, expectedFee);
        assertEq(erc4626.balanceOf(user), expectedNet); // mock 1:1
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_zeroFee_fullAmount() public {
        // fee defaults to 0
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        vault.deposit(entries);

        assertEq(mockUsdc.balanceOf(owner), ownerBefore); // no fee taken
        assertEq(erc4626.balanceOf(user), amount);
    }

    function test_deposit_withFee_multiEntry_proportional() public {
        _setFeeViaTimelock(200); // 2%

        uint256 a1 = 600e6;
        uint256 a2 = 400e6;
        uint256 total = a1 + a2;
        _fundAndApprove(user, total);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](2);
        entries[0] = FortVault.DepositEntry(key4626, a1, 0, "");
        entries[1] = FortVault.DepositEntry(keyAdapter, a2, 0, "");

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        vault.deposit(entries);

        uint256 expectedFee = (total * 200) / 10000; // 20 USDC
        uint256 netTotal = total - expectedFee; // 980 USDC

        assertEq(mockUsdc.balanceOf(owner) - ownerBefore, expectedFee);

        // First entry: (600 * 980) / 1000 = 588
        uint256 expectedFirst = (a1 * netTotal) / total;
        uint256 expectedSecond = netTotal - expectedFirst;

        assertEq(erc4626.balanceOf(user), expectedFirst);
        assertEq(adapter.shares(user), expectedSecond);
        assertEq(mockUsdc.balanceOf(address(vault)), 0);
    }

    function test_deposit_withFee_emitsFeeTaken() public {
        _setFeeViaTimelock(100); // 1%

        uint256 amount = 500e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        uint256 expectedFee = (amount * 100) / 10000;

        vm.expectEmit(true, false, false, true);
        emit FortVault.DepositFeeTaken(user, expectedFee);

        vm.prank(user);
        vault.deposit(entries);
    }

    // ══════════════════════════════════════════════════════════════
    //                    FEE RECIPIENT
    // ══════════════════════════════════════════════════════════════

    function test_setFeeRecipient_works() public {
        address treasury = address(0xBEEF);
        vault.setFeeRecipient(treasury);
        assertEq(vault.feeRecipient(), treasury);
    }

    function test_setFeeRecipient_emitsEvent() public {
        address treasury = address(0xBEEF);
        vm.expectEmit(true, true, false, false);
        emit FortVault.FeeRecipientUpdated(owner, treasury);
        vault.setFeeRecipient(treasury);
    }

    function test_setFeeRecipient_zeroAddress_reverts() public {
        vm.expectRevert(FortVault.ZeroAddress.selector);
        vault.setFeeRecipient(address(0));
    }

    function test_setFeeRecipient_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        vault.setFeeRecipient(address(0xBEEF));
    }

    function test_deposit_feeGoesToRecipient() public {
        address treasury = address(0xBEEF);
        vault.setFeeRecipient(treasury);
        _setFeeViaTimelock(200); // 2%

        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(key4626, amount, 0, "");

        vm.prank(user);
        vault.deposit(entries);

        uint256 expectedFee = (amount * 200) / 10000;
        assertEq(mockUsdc.balanceOf(treasury), expectedFee);
        assertEq(mockUsdc.balanceOf(owner), 0); // owner gets nothing
    }

    function test_defaultFeeRecipient_isOwner() public view {
        assertEq(vault.feeRecipient(), owner);
    }
}
