// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortVault.sol";
import "../src/CrossChainRouter.sol";
import "../src/FortSwapRouter.sol";
import "../src/adapters/LiFiAdapter.sol";

/// @title DeployBase — full FORTRESS protocol deployment on Base
/// @notice Deploys FortVault (UUPS proxy), LiFiAdapter (UUPS proxy), CrossChainRouter (UUPS proxy),
///         then configures protocols and DEX approvals.
contract DeployBase is Script {
    // ── Base mainnet addresses ──
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant MORPHO_MOONWELL_USDC = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;
    address constant AAVE_STATA_USDC = 0xC768c589647798a6EE01A91FdE98EF2ed046DBD6;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);

        console.log("Deployer:", deployer);
        console.log("Keeper:", keeper);

        vm.startBroadcast(deployerPk);

        // ═══════════════════════════════════════════════
        //  1. FortVault (UUPS proxy)
        // ═══════════════════════════════════════════════
        FortVault vaultImpl = new FortVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(FortVault.initialize, (USDC))
        );
        FortVault vault = FortVault(address(vaultProxy));
        console.log("FortVault impl:", address(vaultImpl));
        console.log("FortVault proxy:", address(vaultProxy));

        // ═══════════════════════════════════════════════
        //  2. LiFiAdapter (UUPS proxy)
        // ═══════════════════════════════════════════════
        LiFiAdapter lifiImpl = new LiFiAdapter(USDC, LIFI_DIAMOND);
        ERC1967Proxy lifiProxy = new ERC1967Proxy(
            address(lifiImpl),
            abi.encodeCall(LiFiAdapter.initialize, (deployer, address(vaultProxy)))
        );
        LiFiAdapter lifiAdapter = LiFiAdapter(address(lifiProxy));
        console.log("LiFiAdapter impl:", address(lifiImpl));
        console.log("LiFiAdapter proxy:", address(lifiProxy));

        // ═══════════════════════════════════════════════
        //  3. CrossChainRouter (UUPS proxy)
        // ═══════════════════════════════════════════════
        CrossChainRouter ccImpl = new CrossChainRouter(USDC, LIFI_DIAMOND);
        ERC1967Proxy ccProxy = new ERC1967Proxy(
            address(ccImpl),
            abi.encodeCall(CrossChainRouter.initialize, (keeper, deployer))
        );
        CrossChainRouter ccRouter = CrossChainRouter(address(ccProxy));
        console.log("CrossChainRouter impl:", address(ccImpl));
        console.log("CrossChainRouter proxy:", address(ccProxy));

        // ═══════════════════════════════════════════════
        //  4. FortSwapRouter (UUPS proxy)
        // ═══════════════════════════════════════════════
        FortSwapRouter swapImpl = new FortSwapRouter(USDC, LIFI_DIAMOND);
        ERC1967Proxy swapProxy = new ERC1967Proxy(
            address(swapImpl),
            abi.encodeCall(FortSwapRouter.initialize, (deployer, address(vaultProxy)))
        );
        FortSwapRouter swapRouter = FortSwapRouter(address(swapProxy));
        console.log("FortSwapRouter impl:", address(swapImpl));
        console.log("FortSwapRouter proxy:", address(swapProxy));

        // ═══════════════════════════════════════════════
        //  5. Configure FortVault
        // ═══════════════════════════════════════════════
        vault.registerProtocol("Morpho", MORPHO_MOONWELL_USDC, true);
        vault.registerProtocol("Aave", AAVE_STATA_USDC, true);
        vault.registerProtocol("LiFi", address(lifiAdapter), false);

        // ═══════════════════════════════════════════════
        //  6. Configure LiFiAdapter DEX whitelist
        // ═══════════════════════════════════════════════
        lifiAdapter.setApprovedDex(LIFI_DIAMOND, true);

        // ═══════════════════════════════════════════════
        //  7. Configure FortSwapRouter DEX whitelist
        // ═══════════════════════════════════════════════
        swapRouter.setApprovedDex(LIFI_DIAMOND, true);

        vm.stopBroadcast();

        console.log("--------- Deployment Complete ---------");
        console.log("FortVault (proxy) :", address(vaultProxy));
        console.log("LiFiAdapter (proxy):", address(lifiProxy));
        console.log("CrossChainRouter (proxy):", address(ccProxy));
        console.log("FortSwapRouter (proxy):", address(swapProxy));
        console.log("---------------------------------------");
    }
}
