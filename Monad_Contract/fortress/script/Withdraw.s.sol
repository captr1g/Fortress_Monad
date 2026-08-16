// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/FortVault.sol";

/// @title Withdraw — redeem all shares from Morpho + Aave back to USDC
contract Withdraw is Script {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;
    address constant AAVE_STATA = 0xC768c589647798a6EE01A91FdE98EF2ed046DBD6;

    bytes32 constant MORPHO_KEY = keccak256(abi.encodePacked("Morpho"));
    bytes32 constant AAVE_KEY = keccak256(abi.encodePacked("Aave"));

    function run() external {
        address vaultProxy = vm.envAddress("VAULT_PROXY");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256 morphoShares = IERC20(MORPHO).balanceOf(deployer);
        uint256 aaveShares = IERC20(AAVE_STATA).balanceOf(deployer);
        uint256 usdcBefore = IERC20(USDC).balanceOf(deployer);

        console.log("Morpho shares:", morphoShares);
        console.log("Aave shares:", aaveShares);
        console.log("USDC before:", usdcBefore);

        vm.startBroadcast(pk);

        // Approve vault to pull share tokens
        IERC20(MORPHO).approve(vaultProxy, morphoShares);
        IERC20(AAVE_STATA).approve(vaultProxy, aaveShares);

        // Build withdraw entries
        uint256 count;
        if (morphoShares > 0) count++;
        if (aaveShares > 0) count++;

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](count);
        uint256 idx;

        if (morphoShares > 0) {
            entries[idx++] =
                FortVault.WithdrawEntry({protocolKey: MORPHO_KEY, shares: morphoShares, minUsdcOut: 0, data: ""});
        }

        if (aaveShares > 0) {
            entries[idx] = FortVault.WithdrawEntry({protocolKey: AAVE_KEY, shares: aaveShares, minUsdcOut: 0, data: ""});
        }

        FortVault(vaultProxy).withdraw(entries);

        vm.stopBroadcast();

        uint256 usdcAfter = IERC20(USDC).balanceOf(deployer);
        console.log("--------- Withdraw Complete ---------");
        console.log("USDC after:", usdcAfter);
        console.log("USDC received:", usdcAfter - usdcBefore);
    }
}
