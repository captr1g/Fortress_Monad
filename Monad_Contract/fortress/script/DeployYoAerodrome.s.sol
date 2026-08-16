// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortVault.sol";
import "../src/adapters/YoAdapter.sol";
import "../src/adapters/AerodromeAdapter.sol";

/// @title DeployYoAerodrome — deploy YoAdapter + AerodromeAdapter on existing FortVault
/// @notice Requires VAULT_ADDRESS env var pointing to deployed FortVault proxy.
contract DeployYoAerodrome is Script {
    // ── Base mainnet addresses ──
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant YO_USD = 0x0000000f2eB9f69274678c76222B35eEc7588a65;
    address constant AERO_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERO_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address vaultAddr = vm.envAddress("VAULT_ADDRESS");

        // Optional: USDC-WETH pool config
        address aeroPool = vm.envOr("AERO_POOL", address(0));
        address aeroGauge = vm.envOr("AERO_GAUGE", address(0));

        FortVault vault = FortVault(vaultAddr);

        console.log("Deployer:", deployer);
        console.log("Vault:", vaultAddr);

        vm.startBroadcast(deployerPk);

        // ═══════════════════════════════════════════════
        //  1. YoAdapter
        // ═══════════════════════════════════════════════
        YoAdapter yoImpl = new YoAdapter(USDC, YO_USD);
        ERC1967Proxy yoProxy = new ERC1967Proxy(
            address(yoImpl),
            abi.encodeCall(YoAdapter.initialize, (deployer, vaultAddr))
        );
        YoAdapter yoAdapter = YoAdapter(address(yoProxy));
        vault.registerProtocol("Yo", address(yoAdapter), false);
        console.log("YoAdapter:", address(yoAdapter));

        // ═══════════════════════════════════════════════
        //  2. AerodromeAdapter
        // ═══════════════════════════════════════════════
        AerodromeAdapter aeroImpl = new AerodromeAdapter(USDC, AERO_ROUTER, AERO_FACTORY);
        ERC1967Proxy aeroProxy = new ERC1967Proxy(
            address(aeroImpl),
            abi.encodeCall(AerodromeAdapter.initialize, (deployer, vaultAddr))
        );
        AerodromeAdapter aeroAdapter = AerodromeAdapter(address(aeroProxy));
        vault.registerProtocol("Aerodrome", address(aeroAdapter), false);
        console.log("AerodromeAdapter:", address(aeroAdapter));

        // ═══════════════════════════════════════════════
        //  3. Configure USDC-WETH pool (if env vars set)
        // ═══════════════════════════════════════════════
        if (aeroPool != address(0) && aeroGauge != address(0)) {
            aeroAdapter.addPool("USDC-WETH", aeroPool, aeroGauge, WETH, false);
            console.log("USDC-WETH pool configured");
        }

        vm.stopBroadcast();

        // ═══════════════════════════════════════════════
        //  Summary
        // ═══════════════════════════════════════════════
        console.log("--------- Yo + Aerodrome Deployed ---------");
        console.log("YoAdapter       :", address(yoAdapter));
        console.log("AerodromeAdapter:", address(aeroAdapter));
        console.log("--------------------------------------------");
    }
}
