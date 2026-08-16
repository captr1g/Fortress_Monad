// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";

contract FortVaultAccessTest is FortVaultTestBase {
    address internal nonOwner = address(0x1234);

    function test_pause_unpause() public {
        vault.pause();
        assertTrue(vault.paused());

        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            nonOwner
        ));
        vault.pause();
    }

    function test_unpause_nonOwner_reverts() public {
        vault.pause();
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            nonOwner
        ));
        vault.unpause();
    }

    function test_upgradeToAndCall_nonOwner_reverts() public {
        FortVault newImpl = new FortVault();
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            nonOwner
        ));
        vault.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_owner_succeeds() public {
        FortVault newImpl = new FortVault();
        vault.upgradeToAndCall(address(newImpl), "");
        // No revert = success
    }

    function test_initialize_twice_reverts() public {
        vm.expectRevert();
        vault.initialize(address(mockUsdc));
    }

    function test_ownershipTransfer() public {
        address newOwner = address(0x9999);
        vault.transferOwnership(newOwner);

        // Ownable2Step: pending until accepted
        assertEq(vault.owner(), address(this));

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
    }

}
