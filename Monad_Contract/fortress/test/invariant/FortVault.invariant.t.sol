// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortVault.sol";
import "../mocks/MockUSDC.sol";

/// @notice Handler that wraps FortVault admin operations for invariant fuzzing.
contract FortVaultHandler is Test {
    FortVault public vault;

    constructor(FortVault _vault) {
        vault = _vault;
    }

    /// @notice Queue a fee change with a bounded feeBps.
    function queueFee(uint16 feeBps) external {
        feeBps = uint16(bound(uint256(feeBps), 0, 600)); // allow values above MAX to test guard
        try vault.queueDepositFeeBps(feeBps) {} catch {}
    }

    /// @notice Warp time and execute the pending fee change.
    function executeFee(uint256 warpBy) external {
        warpBy = bound(warpBy, 0, 7 days);
        vm.warp(block.timestamp + warpBy);
        try vault.executeDepositFeeBps() {} catch {}
    }

    /// @notice Toggle pause/unpause.
    function togglePause(bool doPause) external {
        if (doPause) {
            try vault.pause() {} catch {}
        } else {
            try vault.unpause() {} catch {}
        }
    }
}

contract FortVaultInvariantTest is Test {
    FortVault internal vault;
    MockUSDC internal usdc;
    FortVaultHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();

        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (address(usdc)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        handler = new FortVaultHandler(vault);

        // Only fuzz through the handler
        targetContract(address(handler));
    }

    /// @notice Fee BPS must never exceed the max constant.
    function invariant_feeNeverExceedsMax() public view {
        assertLe(vault.depositFeeBps(), vault.MAX_DEPOSIT_FEE_BPS(), "fee exceeds max");
    }

    /// @notice Vault should never hold USDC (it's stateless).
    function invariant_vaultHoldsNoUSDC() public view {
        assertEq(usdc.balanceOf(address(vault)), 0, "vault holds USDC");
    }
}
