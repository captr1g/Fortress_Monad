// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortVault.sol";
import "../src/adapters/CompoundV3Adapter.sol";
import "../src/adapters/PendleAdapter.sol";

/// @title DeployNewProtocols — deploy Fluid, Euler, CompoundV3, Pendle on existing FortVault
/// @notice Requires VAULT_ADDRESS env var pointing to deployed FortVault proxy.
contract DeployNewProtocols is Script {
    // ── Base mainnet addresses ──
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMPOUND_COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;
    address constant FLUID_FUSDC = 0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169;
    address constant PENDLE_ROUTER = 0x888888888889758F76e7103c6CbF23ABbF58F946;
    address constant EULER_EARN_USDC = 0x67f062a12f82c3b42d4CA7a35fb26CbAac28008B;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address vaultAddr = vm.envAddress("VAULT_ADDRESS");

        FortVault vault = FortVault(vaultAddr);

        console.log("Deployer:", deployer);
        console.log("Vault:", vaultAddr);

        vm.startBroadcast(deployerPk);

        // ═══════════════════════════════════════════════
        //  1. Fluid (ERC-4626) — register only
        // ═══════════════════════════════════════════════
        vault.registerProtocol("Fluid", FLUID_FUSDC, true);
        console.log("Fluid registered:", FLUID_FUSDC);

        // ═══════════════════════════════════════════════
        //  2. Euler Earn (ERC-4626) — register only
        // ═══════════════════════════════════════════════
        vault.registerProtocol("Euler", EULER_EARN_USDC, true);
        console.log("Euler registered:", EULER_EARN_USDC);

        // ═══════════════════════════════════════════════
        //  3. CompoundV3 Adapter (UUPS proxy)
        // ═══════════════════════════════════════════════
        CompoundV3Adapter compImpl = new CompoundV3Adapter(USDC, COMPOUND_COMET);
        ERC1967Proxy compProxy = new ERC1967Proxy(
            address(compImpl),
            abi.encodeCall(CompoundV3Adapter.initialize, (deployer, vaultAddr))
        );
        CompoundV3Adapter compAdapter = CompoundV3Adapter(address(compProxy));
        vault.registerProtocol("CompoundV3", address(compAdapter), false);
        console.log("CompoundV3Adapter impl:", address(compImpl));
        console.log("CompoundV3Adapter proxy:", address(compProxy));

        // ═══════════════════════════════════════════════
        //  4. Pendle Adapter (UUPS proxy)
        // ═══════════════════════════════════════════════
        PendleAdapter pendleImpl = new PendleAdapter(USDC, PENDLE_ROUTER);
        ERC1967Proxy pendleProxy = new ERC1967Proxy(
            address(pendleImpl),
            abi.encodeCall(PendleAdapter.initialize, (deployer, vaultAddr))
        );
        PendleAdapter pendleAdapter = PendleAdapter(address(pendleProxy));
        vault.registerProtocol("Pendle", address(pendleAdapter), false);
        console.log("PendleAdapter impl:", address(pendleImpl));
        console.log("PendleAdapter proxy:", address(pendleProxy));

        vm.stopBroadcast();

        console.log("--------- New Protocols Deployed ---------");
        console.log("Fluid (fUSDC)       :", FLUID_FUSDC);
        console.log("Euler Earn (USDC)   :", EULER_EARN_USDC);
        console.log("CompoundV3 (proxy)  :", address(compProxy));
        console.log("Pendle (proxy)      :", address(pendleProxy));
        console.log("------------------------------------------");
    }
}
