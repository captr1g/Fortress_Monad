// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MorphoExitExecutor.sol";

/// @title DeployExitExecutor — deploy the standalone flash-loan exit executor.
/// @notice MorphoExitExecutor is NOT an adapter on FortStrategyExecutor; it is its own
///         contract that the user authorizes on Morpho (setAuthorization). This script:
///           1. Deploys MorphoExitExecutor(MORPHO_BLUE, deployer).
///           2. Allowlists the DEX routers it will swap collateral through on exit.
contract DeployExitExecutor is Script {
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    // DEX routers LiFi routes through on Base (transactionRequest.to of the unwind quote).
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant ODOS_ROUTER = 0xC18D9E84b8687A2645447A61e52c455Dac1675e1;
    address constant BASESWAP = 0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        MorphoExitExecutor exitImpl = new MorphoExitExecutor(MORPHO_BLUE);
        ERC1967Proxy exitProxy =
            new ERC1967Proxy(address(exitImpl), abi.encodeCall(MorphoExitExecutor.initialize, (deployer)));
        MorphoExitExecutor exitExecutor = MorphoExitExecutor(address(exitProxy));

        exitExecutor.setApprovedDex(LIFI_DIAMOND, true);
        exitExecutor.setApprovedDex(ODOS_ROUTER, true);
        exitExecutor.setApprovedDex(BASESWAP, true);

        // LiFi sub-routers on Base (same set the SwapStrategyAdapter allowlists).
        exitExecutor.setApprovedDex(0xAC4c6e212A361c968F1725b4d055b47E63F80b75, true);
        exitExecutor.setApprovedDex(0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d, true);
        exitExecutor.setApprovedDex(0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05, true);
        exitExecutor.setApprovedDex(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5, true);
        exitExecutor.setApprovedDex(0xC10eE9031F2a0B84766A86B55a8D90F357910fb4, true);

        vm.stopBroadcast();

        console.log("=== Deployed MorphoExitExecutor ===");
        console.log("MorphoExitExecutor:", address(exitExecutor));
        console.log("");
        console.log("=== Update your backend .env with ===");
        console.log("FORTRESS_MORPHO_EXIT_EXECUTOR=%s", vm.toString(address(exitExecutor)));
    }
}
