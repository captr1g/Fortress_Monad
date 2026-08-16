// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortStrategyExecutor.sol";
import "../src/adapters/MorphoStrategyAdapter.sol";
import "../src/adapters/SwapStrategyAdapter.sol";

/// @title RedeployAdapters — deploy new adapters and register them on the existing executor.
/// @notice The executor proxy address stays the same (users keep their approvals).
///         This script:
///           1. Deploys the new MorphoStrategyAdapter (oracle-based borrow).
///           2. Deploys the new SwapStrategyAdapter (full-balance mode).
///           3. Removes the old adapters from the executor.
///           4. Registers the new ones at the same adapter IDs (0=swap, 1=morpho).
///           5. Allowlists the DEX routers on the new swap adapter.
contract RedeployAdapters is Script {
    // Adapter IDs
    uint8 constant SWAP_ID = 0;
    uint8 constant MORPHO_ID = 1;

    // Protocol addresses
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    // DEX routers to allowlist on the new swap adapter
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant ODOS_ROUTER = 0xC18D9E84b8687A2645447A61e52c455Dac1675e1;
    address constant BASESWAP = 0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address executorAddr = vm.envAddress("EXECUTOR_ADDRESS");

        FortStrategyExecutor executor = FortStrategyExecutor(executorAddr);

        vm.startBroadcast(deployerKey);

        //Deploy new adapters

        MorphoStrategyAdapter morphoImpl = new MorphoStrategyAdapter(MORPHO_BLUE);
        ERC1967Proxy morphoProxy = new ERC1967Proxy(
            address(morphoImpl),
            abi.encodeCall(MorphoStrategyAdapter.initialize, (executorAddr, deployer))
        );
        MorphoStrategyAdapter newMorphoAdapter = MorphoStrategyAdapter(address(morphoProxy));

        // SwapStrategyAdapter newSwapAdapter = new SwapStrategyAdapter(
        //     executorAddr,
        //     deployer
        // );

        // Remove old executors

        // executor.removeAdapter(SWAP_ID);
        executor.removeAdapter(MORPHO_ID);

        // register new one

        // executor.registerAdapter(SWAP_ID, address(newSwapAdapter));
        executor.registerAdapter(MORPHO_ID, address(newMorphoAdapter));

        // Allowlist for lifi

        // newSwapAdapter.setApprovedDex(LIFI_DIAMOND, true);
        // newSwapAdapter.setApprovedDex(ODOS_ROUTER, true);
        // newSwapAdapter.setApprovedDex(BASESWAP, true);

        vm.stopBroadcast();

        // ─── Output ───────────────────────────────────────────────────────────

        console.log("=== Adapters Redeployed ===");
        console.log("Executor (unchanged):", executorAddr);
        // console.log("New MorphoStrategyAdapter:", address(newMorphoAdapter));
        // console.log("New SwapStrategyAdapter:", address(newSwapAdapter));
        console.log("");
        console.log("=== Update your backend .env with ===");
        console.log(
            "FORTRESS_MORPHO_ADAPTER=%s",
            vm.toString(address(newMorphoAdapter))
        );
        // console.log(
        //     "FORTRESS_SWAP_ADAPTER=%s",
        //     vm.toString(address(newSwapAdapter))
        // );
    }
}
