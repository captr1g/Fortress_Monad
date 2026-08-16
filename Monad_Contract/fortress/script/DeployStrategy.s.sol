// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FortStrategyExecutor.sol";
import "../src/adapters/MorphoStrategyAdapter.sol";
import "../src/adapters/SwapStrategyAdapter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract DeployStrategy is Script {
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // 1. Deploy FortStrategyExecutor (UUPS proxy)
        FortStrategyExecutor executorImpl = new FortStrategyExecutor();
        ERC1967Proxy executorProxy =
            new ERC1967Proxy(address(executorImpl), abi.encodeCall(FortStrategyExecutor.initialize, ()));
        FortStrategyExecutor executor = FortStrategyExecutor(address(executorProxy));

        // 2. Deploy MorphoStrategyAdapter (UUPS proxy)
        MorphoStrategyAdapter morphoImpl = new MorphoStrategyAdapter(MORPHO_BLUE);
        ERC1967Proxy morphoProxy = new ERC1967Proxy(
            address(morphoImpl), abi.encodeCall(MorphoStrategyAdapter.initialize, (address(executor), deployer))
        );
        MorphoStrategyAdapter morphoAdapter = MorphoStrategyAdapter(address(morphoProxy));

        // 3. Deploy SwapStrategyAdapter (UUPS proxy)
        SwapStrategyAdapter swapImpl = new SwapStrategyAdapter();
        ERC1967Proxy swapProxy = new ERC1967Proxy(
            address(swapImpl), abi.encodeCall(SwapStrategyAdapter.initialize, (address(executor), deployer))
        );
        SwapStrategyAdapter swapAdapter = SwapStrategyAdapter(address(swapProxy));

        // 4. Register adapters on executor (swap=0, morpho=1)
        executor.registerAdapter(0, address(swapAdapter));
        executor.registerAdapter(1, address(morphoAdapter));

        // 5. Approve DEX routers
        swapAdapter.setApprovedDex(LIFI_DIAMOND, true);
        swapAdapter.setApprovedDex(0xC18D9E84b8687A2645447A61e52c455Dac1675e1, true); // OdosRouter
        swapAdapter.setApprovedDex(0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c, true); // BaseSwap

        vm.stopBroadcast();

        console.log("=== Deployed Strategy Contracts ===");
        console.log("FortStrategyExecutor (proxy):", address(executor));
        console.log("MorphoStrategyAdapter (proxy):", address(morphoAdapter));
        console.log("SwapStrategyAdapter (proxy):", address(swapAdapter));
    }
}
