// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/adapters/SwapStrategyAdapter.sol";

contract ApproveDexes is Script {
    // Deployed SwapStrategyAdapter (executor.getAdapter(0))
    address constant SWAP_ADAPTER = 0x9C476D6B9a6d9a797dC7e43Cdd6810e44197A1EE;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        SwapStrategyAdapter adapter = SwapStrategyAdapter(SWAP_ADAPTER);

        // Approve all known LiFi sub-routers on Base (checksummed)
        adapter.setApprovedDex(0xAC4c6e212A361c968F1725b4d055b47E63F80b75, true);
        adapter.setApprovedDex(0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d, true);
        adapter.setApprovedDex(0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05, true);
        adapter.setApprovedDex(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5, true);
        adapter.setApprovedDex(0xC10eE9031F2a0B84766A86B55a8D90F357910fb4, true);

        vm.stopBroadcast();

        console.log("Approved 5 new DEX routers on SwapStrategyAdapter");
    }
}
