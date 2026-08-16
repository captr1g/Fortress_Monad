// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FortVault.sol";
import "../src/CrossChainRouter.sol";
import "../src/FortSwapRouter.sol";
import "../src/adapters/LiFiAdapter.sol";

/// @title PostDeploy — verify & configure FORTRESS after initial deployment
/// @notice Run after DeployBase. Reads deployed addresses from env, verifies
///         state, optionally adds protocols/DEXes, and transfers ownership.
contract PostDeploy is Script {
    // ── Base mainnet constants ──
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;
    address constant MORPHO_MOONWELL_USDC = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;
    address constant AAVE_STATA_USDC = 0xC768c589647798a6EE01A91FdE98EF2ed046DBD6; // StataTokenV2 (ERC-4626)

    function run() external {
        // ═══════════════════════════════════════════════
        //  Load deployed addresses from env
        // ═══════════════════════════════════════════════
        address vaultProxy = vm.envAddress("VAULT_PROXY");
        address lifiAdapterAddr = vm.envAddress("LIFI_ADAPTER");
        address ccRouterAddr = vm.envAddress("CROSS_CHAIN_ROUTER");
        address swapRouterAddr = vm.envAddress("SWAP_ROUTER");

        FortVault vault = FortVault(vaultProxy);
        LiFiAdapter lifiAdapter = LiFiAdapter(lifiAdapterAddr);
        CrossChainRouter ccRouter = CrossChainRouter(ccRouterAddr);
        FortSwapRouter swapRouter = FortSwapRouter(swapRouterAddr);

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        // ═══════════════════════════════════════════════
        //  Phase 1: Verify deployment state (read-only)
        // ═══════════════════════════════════════════════
        console.log("========= Verification =========");

        // -- FortVault --
        _verify("Vault: USDC", address(vault.usdc()), USDC);
        _verify("Vault: owner", vault.owner(), deployer);
        require(!vault.paused(), "Vault: should not be paused");
        console.log("Vault: paused = false [OK]");

        uint256 pCount = vault.protocolCount();
        console.log("Vault: protocolCount =", pCount);

        // Verify Morpho registered
        bytes32 morphoKey = keccak256(abi.encodePacked("Morpho"));
        (address morphoAddr, bool morphoIs4626) = vault.protocols(morphoKey);
        _verify("Vault: Morpho addr", morphoAddr, MORPHO_MOONWELL_USDC);
        require(morphoIs4626, "Vault: Morpho should be ERC4626");
        console.log("Vault: Morpho isERC4626 = true [OK]");

        // Verify Aave registered
        bytes32 aaveKey = keccak256(abi.encodePacked("Aave"));
        (address aaveAddr, bool aaveIs4626) = vault.protocols(aaveKey);
        _verify("Vault: Aave addr", aaveAddr, AAVE_STATA_USDC);
        require(aaveIs4626, "Vault: Aave should be ERC4626");
        console.log("Vault: Aave isERC4626 = true [OK]");

        // Verify LiFi adapter registered
        bytes32 lifiKey = keccak256(abi.encodePacked("LiFi"));
        (address regLifi, bool lifiIs4626) = vault.protocols(lifiKey);
        _verify("Vault: LiFi adapter", regLifi, lifiAdapterAddr);
        require(!lifiIs4626, "Vault: LiFi should not be ERC4626");
        console.log("Vault: LiFi isERC4626 = false [OK]");

        // -- LiFiAdapter --
        _verify("LiFiAdapter: USDC", address(lifiAdapter.usdc()), USDC);
        _verify("LiFiAdapter: lifiDiamond", lifiAdapter.lifiDiamond(), LIFI_DIAMOND);
        _verify("LiFiAdapter: owner", lifiAdapter.owner(), deployer);
        require(lifiAdapter.isApprovedDex(LIFI_DIAMOND), "LiFiAdapter: LiFi Diamond not approved");
        console.log("LiFiAdapter: LiFi Diamond DEX approved [OK]");

        // -- CrossChainRouter --
        _verify("CCRouter: USDC", address(ccRouter.usdc()), USDC);
        _verify("CCRouter: lifiDiamond", ccRouter.lifiDiamond(), LIFI_DIAMOND);
        _verify("CCRouter: owner", ccRouter.owner(), deployer);
        require(!ccRouter.paused(), "CCRouter: should not be paused");
        console.log("CCRouter: paused = false [OK]");
        console.log("CCRouter: keeper =", ccRouter.keeper());

        // -- FortSwapRouter --
        _verify("SwapRouter: owner", swapRouter.owner(), deployer);
        _verify("SwapRouter: vault", swapRouter.vault(), vaultProxy);
        require(swapRouter.isApprovedDex(LIFI_DIAMOND), "SwapRouter: LiFi Diamond not approved");
        console.log("SwapRouter: LiFi Diamond DEX approved [OK]");

        console.log("========= Verification PASSED =========");

        // ═══════════════════════════════════════════════
        //  Phase 2: Optional configuration (broadcast)
        // ═══════════════════════════════════════════════
        //
        // Uncomment sections below as needed.
        // Each section is independent — enable only what you need.
        //

        vm.startBroadcast(deployerPk);

        // ── 2a. Register additional ERC-4626 protocols ──
        // vault.registerProtocol("Compound", 0x...compVaultAddr, true);

        // ── 2b. Register additional custom adapters ──
        // vault.registerProtocol("Yearn", 0x...yearnAdapterAddr, false);

        // ── 2c. Approve additional DEX routers on swap router ──
        // swapRouter.setApprovedDex(0x...paraswapRouter, true);
        // swapRouter.setApprovedDex(0x...oneInchRouter, true);

        // ── 2d. Approve additional DEX routers on LiFiAdapter ──
        // lifiAdapter.setApprovedDex(0x...paraswapRouter, true);

        // ── 2e. Update keeper on CrossChainRouter ──
        // ccRouter.setKeeper(0x...newKeeperAddr);

        // ── 2f. Transfer ownership (Ownable2Step) ──
        //   Step 1: current owner initiates transfer
        //   Step 2: new owner must call acceptOwnership() separately
        //
        // address multisig = vm.envAddress("MULTISIG");
        // vault.transferOwnership(multisig);
        // lifiAdapter.transferOwnership(multisig);
        // ccRouter.transferOwnership(multisig);
        // console.log("Ownership transfer initiated to:", multisig);

        vm.stopBroadcast();

        console.log("========= PostDeploy Complete =========");
    }

    // ── Helpers ──

    function _verify(string memory label, address actual, address expected) internal pure {
        require(
            actual == expected,
            string.concat(label, ": MISMATCH - expected ", vm.toString(expected), " got ", vm.toString(actual))
        );
        console.log(string.concat(label, " = ", vm.toString(actual), " [OK]"));
    }
}
