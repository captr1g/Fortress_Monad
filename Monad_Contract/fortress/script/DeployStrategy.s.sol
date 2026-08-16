// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FortStrategyExecutor.sol";
import "../src/adapters/MorphoStrategyAdapter.sol";
import "../src/adapters/SwapStrategyAdapter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/config/MonadAddresses.sol";

contract DeployStrategy is Script {
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
        MorphoStrategyAdapter morphoImpl = new MorphoStrategyAdapter(MonadAddresses.MORPHO_BLUE);
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

        // Monad DEX / aggregator allowlist. Every address verified to hold code on
        // chain 143 and cross-checked against monad-crypto/protocols (Phase 2).
        // The Base list (Odos, BaseSwap, LI.FI sub-routers) is NOT carried over —
        // see the collision warning in src/config/MonadAddresses.sol.
        swapAdapter.setApprovedDex(MonadAddresses.LIFI_DIAMOND, true);
        swapAdapter.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);
        swapAdapter.setApprovedDex(MonadAddresses.OPENOCEAN_EXCHANGE_PROXY, true);
        swapAdapter.setApprovedDex(MonadAddresses.EISEN_DIAMOND, true);
        swapAdapter.setApprovedDex(MonadAddresses.MONORAIL_AGGREGATION_ROUTER, true);
        swapAdapter.setApprovedDex(MonadAddresses.KURU_ROUTER, true);

        vm.stopBroadcast();

        console.log("=== Deployed Strategy Contracts ===");
        console.log("FortStrategyExecutor (proxy):", address(executor));
        console.log("MorphoStrategyAdapter (proxy):", address(morphoAdapter));
        console.log("SwapStrategyAdapter (proxy):", address(swapAdapter));
    }
}
