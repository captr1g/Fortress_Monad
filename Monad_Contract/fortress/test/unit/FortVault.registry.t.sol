// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";

contract FortVaultRegistryTest is FortVaultTestBase {
    address constant PROTOCOL_ADDR = address(0xBEEF);
    address constant PROTOCOL_ADDR2 = address(0xCAFE);
    address constant PROTOCOL_ADDR3 = address(0xFACE);

    function test_registerProtocol() public {
        vm.expectEmit(true, false, false, true);
        bytes32 expectedKey = keccak256(bytes("Morpho"));
        emit FortVault.ProtocolRegistered(expectedKey, "Morpho", PROTOCOL_ADDR, true);

        vault.registerProtocol("Morpho", PROTOCOL_ADDR, true);

        (address addr, bool isERC4626) = vault.protocols(expectedKey);
        assertEq(addr, PROTOCOL_ADDR);
        assertTrue(isERC4626);
        assertEq(vault.protocolCount(), 1);
    }

    function test_registerProtocol_duplicate_reverts() public {
        vault.registerProtocol("Morpho", PROTOCOL_ADDR, true);

        bytes32 key = keccak256(bytes("Morpho"));
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolExists.selector, key));
        vault.registerProtocol("Morpho", PROTOCOL_ADDR2, false);
    }

    function test_registerProtocol_zeroAddr_reverts() public {
        vm.expectRevert(FortVault.ZeroAddress.selector);
        vault.registerProtocol("Bad", address(0), true);
    }

    function test_registerProtocol_nonOwner_reverts() public {
        address nonOwner = address(0x1234);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            nonOwner
        ));
        vault.registerProtocol("Morpho", PROTOCOL_ADDR, true);
    }

    function test_removeProtocol() public {
        vault.registerProtocol("Morpho", PROTOCOL_ADDR, true);
        bytes32 key = keccak256(bytes("Morpho"));

        vm.expectEmit(true, false, false, false);
        emit FortVault.ProtocolRemoved(key);

        vault.removeProtocol("Morpho");

        (address addr,) = vault.protocols(key);
        assertEq(addr, address(0));
        assertEq(vault.protocolCount(), 0);
    }

    function test_removeProtocol_notFound_reverts() public {
        bytes32 key = keccak256(bytes("Ghost"));
        vm.expectRevert(abi.encodeWithSelector(FortVault.ProtocolNotFound.selector, key));
        vault.removeProtocol("Ghost");
    }

    function test_protocolCount_multipleRegistrations() public {
        vault.registerProtocol("A", PROTOCOL_ADDR, true);
        vault.registerProtocol("B", PROTOCOL_ADDR2, false);
        vault.registerProtocol("C", PROTOCOL_ADDR3, true);
        assertEq(vault.protocolCount(), 3);

        vault.removeProtocol("B");
        assertEq(vault.protocolCount(), 2);
    }
}
