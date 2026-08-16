// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FortVault.sol";
import "../src/CrossChainRouter.sol";
import "../src/FortSwapRouter.sol";
import "../src/adapters/LiFiAdapter.sol";
import "../src/config/MonadAddresses.sol";

/// @title PostDeploy — verify & configure FORTRESS after initial deployment
/// @notice Run after DeployMonad. Reads deployed addresses from env, verifies
///         state, optionally adds protocols/DEXes, and transfers ownership.
contract PostDeploy is Script {
    function run() external {
        // ═══════════════════════════════════════════════
        //  Load deployed addresses from env
        // ═══════════════════════════════════════════════
        address vaultProxy = vm.envAddress("VAULT_PROXY");
        address lifiAdapterAddr = vm.envAddress("LIFI_ADAPTER");
        address ccRouterAddr = vm.envAddress("CROSS_CHAIN_ROUTER");
        address swapRouterAddr = vm.envAddress("SWAP_ROUTER");

        FortVault vault = FortVault(vaultProxy);
        LiFiAdapter lifiAdapter = LiFiAdapter(payable(lifiAdapterAddr));
        CrossChainRouter ccRouter = CrossChainRouter(ccRouterAddr);
        FortSwapRouter swapRouter = FortSwapRouter(swapRouterAddr);

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        // ═══════════════════════════════════════════════
        //  Phase 1: Verify deployment state (read-only)
        // ═══════════════════════════════════════════════
        console.log("========= Verification =========");

        // -- FortVault --
        _verify("Vault: MonadAddresses.USDC", address(vault.usdc()), MonadAddresses.USDC);
        _verify("Vault: owner", vault.owner(), deployer);
        require(!vault.paused(), "Vault: should not be paused");
        console.log("Vault: paused = false [OK]");

        uint256 pCount = vault.protocolCount();
        console.log("Vault: protocolCount =", pCount);

        // Verify Morpho registered
        bytes32 morphoKey = keccak256(abi.encodePacked("Morpho"));
        (address morphoAddr, bool morphoIs4626) = vault.protocols(morphoKey);
        _verify("Vault: Morpho addr", morphoAddr, MonadAddresses.VAULT_HYPERITHM_USDC_APEX);
        require(morphoIs4626, "Vault: Morpho should be ERC4626");
        console.log("Vault: Morpho isERC4626 = true [OK]");

        // Phase 2: the "Aave" registry key is not deployed on Monad. FORTRESS does
        // not integrate Aave here; doing so needs explicit operator instruction
        // (port prompt §3.4). Assert it is absent rather than silently skipping.
        bytes32 aaveKey = keccak256(abi.encodePacked("Aave"));
        (address aaveAddr,) = vault.protocols(aaveKey);
        require(aaveAddr == address(0), "Vault: Aave must NOT be registered on Monad");
        console.log("Vault: Aave absent as expected [OK]");

        // Verify LiFi adapter registered
        bytes32 lifiKey = keccak256(abi.encodePacked("LiFi"));
        (address regLifi, bool lifiIs4626) = vault.protocols(lifiKey);
        _verify("Vault: LiFi adapter", regLifi, lifiAdapterAddr);
        require(!lifiIs4626, "Vault: LiFi should not be ERC4626");
        console.log("Vault: LiFi isERC4626 = false [OK]");

        // -- LiFiAdapter --
        _verify("LiFiAdapter: MonadAddresses.USDC", address(lifiAdapter.usdc()), MonadAddresses.USDC);
        _verify("LiFiAdapter: lifiDiamond", lifiAdapter.lifiDiamond(), MonadAddresses.LIFI_DIAMOND);
        _verify("LiFiAdapter: owner", lifiAdapter.owner(), deployer);
        require(lifiAdapter.isApprovedDex(MonadAddresses.LIFI_DIAMOND), "LiFiAdapter: LiFi Diamond not approved");
        console.log("LiFiAdapter: LiFi Diamond DEX approved [OK]");

        // -- CrossChainRouter --
        _verify("CCRouter: MonadAddresses.USDC", address(ccRouter.usdc()), MonadAddresses.USDC);
        _verify("CCRouter: lifiDiamond", ccRouter.lifiDiamond(), MonadAddresses.LIFI_DIAMOND);
        _verify("CCRouter: owner", ccRouter.owner(), deployer);
        require(!ccRouter.paused(), "CCRouter: should not be paused");
        console.log("CCRouter: paused = false [OK]");
        console.log("CCRouter: keeper =", ccRouter.keeper());

        // -- FortSwapRouter --
        _verify("SwapRouter: owner", swapRouter.owner(), deployer);
        _verify("SwapRouter: vault", swapRouter.vault(), vaultProxy);
        require(swapRouter.isApprovedDex(MonadAddresses.LIFI_DIAMOND), "SwapRouter: LiFi Diamond not approved");
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
        // vault.registerProtocol("<Name>", <MonadAddresses constant>, true);

        // ── 2b. Register additional custom adapters ──
        // vault.registerProtocol("<Name>", <deployed adapter>, false);

        // ── 2c. Approve additional DEX routers on swap router ──

        // ── 2d. Approve additional DEX routers on LiFiAdapter ──

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

        // Monad DEX / aggregator allowlist. Every address verified to hold code on
        // chain 143 and cross-checked against monad-crypto/protocols (Phase 2).
        // The Base list (Odos, BaseSwap, LI.FI sub-routers) is NOT carried over —
        // see the collision warning in src/config/MonadAddresses.sol.
        swapRouter.setApprovedDex(MonadAddresses.LIFI_DIAMOND, true);
        swapRouter.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);
        swapRouter.setApprovedDex(MonadAddresses.OPENOCEAN_EXCHANGE_PROXY, true);
        swapRouter.setApprovedDex(MonadAddresses.EISEN_DIAMOND, true);
        swapRouter.setApprovedDex(MonadAddresses.MONORAIL_AGGREGATION_ROUTER, true);
        swapRouter.setApprovedDex(MonadAddresses.KURU_ROUTER, true);

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
