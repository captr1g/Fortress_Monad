// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortStrategyExecutor.sol";
import "../src/adapters/PendleStrategyAdapter.sol";
import "../src/config/MonadAddresses.sol";

/// @title DeployPendleAdapter — redeploy PendleStrategyAdapter (v2 with sub-actions + wrap).
/// @notice Removes the old adapter at ID 2, deploys the new one, and registers it.
///
///         Usage:
///           source .env
///           EXECUTOR_ADDRESS=<deployed FortStrategyExecutor> \
///             forge script script/DeployPendleAdapter.s.sol --rpc-url $MONAD_RPC_URL --broadcast --slow
contract DeployPendleAdapter is Script {
    uint8 constant PENDLE_ID = 2;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address executorAddr = vm.envAddress("EXECUTOR_ADDRESS");

        FortStrategyExecutor executor = FortStrategyExecutor(executorAddr);

        vm.startBroadcast(deployerKey);

        // 1. Remove old adapter at ID 2 (if registered)
        if (executor.getAdapter(PENDLE_ID) != address(0)) {
            executor.removeAdapter(PENDLE_ID);
        }

        // 2. Deploy new PendleStrategyAdapter (UUPS proxy)
        PendleStrategyAdapter pendleImpl = new PendleStrategyAdapter(MonadAddresses.PENDLE_ROUTER_V4);
        ERC1967Proxy pendleProxy = new ERC1967Proxy(
            address(pendleImpl), abi.encodeCall(PendleStrategyAdapter.initialize, (executorAddr, deployer))
        );
        PendleStrategyAdapter pendleAdapter = PendleStrategyAdapter(address(pendleProxy));

        // 3. Register on executor as adapter ID 2
        executor.registerAdapter(PENDLE_ID, address(pendleAdapter));

        vm.stopBroadcast();

        console.log("=== Pendle Adapter Redeployed ===");
        console.log("Executor (unchanged):", executorAddr);
        console.log("PendleStrategyAdapter:", address(pendleAdapter));
        console.log("Adapter ID:", PENDLE_ID);
        console.log("Pendle Router:", MonadAddresses.PENDLE_ROUTER_V4);
        console.log("");
        console.log("=== Update .env with ===");
        console.log("FORTRESS_PENDLE_ADAPTER=%s", vm.toString(address(pendleAdapter)));
        console.log("");
        console.log("=== Post-deploy: approve LP wrappers ===");
        console.log("Call pendleAdapter.setApprovedWrapper(<wrapperAddr>, true) for each market.");
    }
}
