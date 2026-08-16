// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "../src/FortVault.sol";
import "../src/config/MonadAddresses.sol";

contract Withdraw is Script {
    bytes32 constant MORPHO_KEY = keccak256(abi.encodePacked("Morpho"));

    function run() external {
        address vaultProxy = vm.envAddress("VAULT_PROXY");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint256 morphoShares = IERC20(MonadAddresses.VAULT_HYPER_USDCA).balanceOf(deployer);
        uint256 usdcBefore = IERC20(MonadAddresses.USDC).balanceOf(deployer);

        console.log("Morpho shares:", morphoShares);
        console.log("USDC before:", usdcBefore);

        vm.startBroadcast(pk);

        // Approve vault to pull share tokens
        IERC20(MonadAddresses.VAULT_HYPER_USDCA).approve(vaultProxy, morphoShares);

        // Build withdraw entries
        uint256 count;
        if (morphoShares > 0) count++;

        FortVault.WithdrawEntry[] memory entries = new FortVault.WithdrawEntry[](count);
        uint256 idx;

        if (morphoShares > 0) {
            entries[idx++] =
                FortVault.WithdrawEntry({protocolKey: MORPHO_KEY, shares: morphoShares, minUsdcOut: 0, data: ""});
        }

        FortVault(vaultProxy).withdraw(entries);

        vm.stopBroadcast();

        uint256 usdcAfter = IERC20(MonadAddresses.USDC).balanceOf(deployer);
        console.log("--------- Withdraw Complete ---------");
        console.log("USDC after:", usdcAfter);
        console.log("MonadAddresses.USDC received:", usdcAfter - usdcBefore);
    }
}
