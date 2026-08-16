// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/MorphoLeverageExecutor.sol";

/// @title DeployLeverageExecutor — deploy MorphoLeverageExecutor as UUPS proxy.
contract DeployLeverageExecutor is Script {
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;

    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant ODOS_ROUTER = 0xC18D9E84b8687A2645447A61e52c455Dac1675e1;
    address constant BASESWAP = 0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // Deploy implementation + proxy
        MorphoLeverageExecutor impl = new MorphoLeverageExecutor(MORPHO_BLUE);
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(MorphoLeverageExecutor.initialize, (deployer))
        );
        MorphoLeverageExecutor leverageExecutor = MorphoLeverageExecutor(address(proxy));

        // Allowlist DEX routers
        leverageExecutor.setApprovedDex(LIFI_DIAMOND, true);
        leverageExecutor.setApprovedDex(ODOS_ROUTER, true);
        leverageExecutor.setApprovedDex(BASESWAP, true);

        // LiFi sub-routers on Base
        leverageExecutor.setApprovedDex(0xAC4c6e212A361c968F1725b4d055b47E63F80b75, true);
        leverageExecutor.setApprovedDex(0xC87De04e2EC1F4282dFF2933A2D58199f688fC3d, true);
        leverageExecutor.setApprovedDex(0x0D05a7D3448512B78fa8A9e46c4872C88C4a0D05, true);
        leverageExecutor.setApprovedDex(0x6131B5fae19EA4f9D964eAc0408E4408b66337b5, true);
        leverageExecutor.setApprovedDex(0xC10eE9031F2a0B84766A86B55a8D90F357910fb4, true);

        vm.stopBroadcast();

        console.log("=== Deployed MorphoLeverageExecutor ===");
        console.log("Implementation:", address(impl));
        console.log("Proxy:", address(proxy));
    }
}
