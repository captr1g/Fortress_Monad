// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MorphoLeverageExecutor.sol";
import "../src/config/MonadAddresses.sol";

/// @title DeployLeverageExecutor — deploy MorphoLeverageExecutor as UUPS proxy.
contract DeployLeverageExecutor is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy implementation + proxy
        MorphoLeverageExecutor impl = new MorphoLeverageExecutor(MonadAddresses.MORPHO_BLUE);
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(MorphoLeverageExecutor.initialize, (deployer)));
        MorphoLeverageExecutor leverageExecutor = MorphoLeverageExecutor(address(proxy));

        // Allowlist DEX routers

        // Monad DEX / aggregator allowlist. Every address verified to hold code on
        // chain 143 and cross-checked against monad-crypto/protocols (Phase 2).
        // The Base list (Odos, BaseSwap, LI.FI sub-routers) is NOT carried over —
        // see the collision warning in src/config/MonadAddresses.sol.
        leverageExecutor.setApprovedDex(MonadAddresses.LIFI_DIAMOND, true);
        leverageExecutor.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);
        leverageExecutor.setApprovedDex(MonadAddresses.OPENOCEAN_EXCHANGE_PROXY, true);
        leverageExecutor.setApprovedDex(MonadAddresses.EISEN_DIAMOND, true);
        leverageExecutor.setApprovedDex(MonadAddresses.MONORAIL_AGGREGATION_ROUTER, true);
        leverageExecutor.setApprovedDex(MonadAddresses.KURU_ROUTER, true);

        vm.stopBroadcast();

        console.log("=== Deployed MorphoLeverageExecutor ===");
        console.log("Implementation:", address(impl));
        console.log("Proxy:", address(proxy));
    }
}
