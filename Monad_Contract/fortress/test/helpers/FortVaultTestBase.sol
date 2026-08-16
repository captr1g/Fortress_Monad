// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../mocks/MockUSDC.sol";

abstract contract FortVaultTestBase is Test {
    FortVault internal vault;
    MockUSDC internal mockUsdc;
    address internal owner;

    function setUp() public virtual {
        owner = address(this);

        // Deploy MockUSDC
        mockUsdc = new MockUSDC();

        // Deploy implementation
        FortVault impl = new FortVault();

        // Deploy proxy
        bytes memory initData = abi.encodeCall(FortVault.initialize, (address(mockUsdc)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));
    }

    function _fundAndApprove(address user, uint256 amount) internal {
        mockUsdc.mint(user, amount);
        vm.prank(user);
        mockUsdc.approve(address(vault), amount);
    }
}
