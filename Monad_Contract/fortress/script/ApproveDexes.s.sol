// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/adapters/SwapStrategyAdapter.sol";
import "../src/config/MonadAddresses.sol";

contract ApproveDexes is Script {
    // Deployed SwapStrategyAdapter (executor.getAdapter(0))

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        SwapStrategyAdapter adapter = SwapStrategyAdapter(vm.envAddress("SWAP_ADAPTER"));

        // Monad DEX / aggregator allowlist. Every address verified to hold code on
        // chain 143 and cross-checked against monad-crypto/protocols (Phase 2).
        // The Base list (Odos, BaseSwap, LI.FI sub-routers) is NOT carried over —
        // see the collision warning in src/config/MonadAddresses.sol.
        adapter.setApprovedDex(MonadAddresses.LIFI_DIAMOND, true);
        adapter.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);
        adapter.setApprovedDex(MonadAddresses.OPENOCEAN_EXCHANGE_PROXY, true);
        adapter.setApprovedDex(MonadAddresses.EISEN_DIAMOND, true);
        adapter.setApprovedDex(MonadAddresses.MONORAIL_AGGREGATION_ROUTER, true);
        adapter.setApprovedDex(MonadAddresses.KURU_ROUTER, true);

        vm.stopBroadcast();

        console.log("Approved 5 new DEX routers on SwapStrategyAdapter");
    }
}
