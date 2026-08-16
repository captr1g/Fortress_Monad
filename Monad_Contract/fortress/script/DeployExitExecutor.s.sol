// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MorphoExitExecutor.sol";
import "../src/config/MonadAddresses.sol";

/// @title DeployExitExecutor — deploy the standalone flash-loan exit executor.
/// @notice MorphoExitExecutor is NOT an adapter on FortStrategyExecutor; it is its own
///         contract that the user authorizes on Morpho (setAuthorization). This script:
///           1. Deploys MorphoExitExecutor(MonadAddresses.MORPHO_BLUE, deployer).
///           2. Allowlists the DEX routers it will swap collateral through on exit.
contract DeployExitExecutor is Script {
    // DEX routers LiFi routes through on Base (transactionRequest.to of the unwind quote).

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        MorphoExitExecutor exitImpl = new MorphoExitExecutor(MonadAddresses.MORPHO_BLUE);
        ERC1967Proxy exitProxy =
            new ERC1967Proxy(address(exitImpl), abi.encodeCall(MorphoExitExecutor.initialize, (deployer)));
        MorphoExitExecutor exitExecutor = MorphoExitExecutor(address(exitProxy));

        // Monad DEX / aggregator allowlist. Every address verified to hold code on
        // chain 143 and cross-checked against monad-crypto/protocols (Phase 2).
        // The Base list (Odos, BaseSwap, LI.FI sub-routers) is NOT carried over —
        // see the collision warning in src/config/MonadAddresses.sol.
        exitExecutor.setApprovedDex(MonadAddresses.LIFI_DIAMOND, true);
        exitExecutor.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);
        exitExecutor.setApprovedDex(MonadAddresses.OPENOCEAN_EXCHANGE_PROXY, true);
        exitExecutor.setApprovedDex(MonadAddresses.EISEN_DIAMOND, true);
        exitExecutor.setApprovedDex(MonadAddresses.MONORAIL_AGGREGATION_ROUTER, true);
        exitExecutor.setApprovedDex(MonadAddresses.KURU_ROUTER, true);

        vm.stopBroadcast();

        console.log("=== Deployed MorphoExitExecutor ===");
        console.log("MorphoExitExecutor:", address(exitExecutor));
        console.log("");
        console.log("=== Update your backend .env with ===");
        console.log("FORTRESS_MORPHO_EXIT_EXECUTOR=%s", vm.toString(address(exitExecutor)));
    }
}
