// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortVault.sol";
import "../src/CrossChainRouter.sol";
import "../src/FortSwapRouter.sol";
import "../src/adapters/LiFiAdapter.sol";
import "../src/config/MonadAddresses.sol";

/// @title DeployMonad — full FORTRESS protocol deployment on Monad (chain 143)
/// @notice Replaces the Base-targeted `DeployBase.s.sol`. Every third-party
///         address comes from `MonadAddresses`; none is written inline.
///
/// @dev Divergences from the Base deployment, all forced by Monad reality:
///
///      1. The `"Aave"` registry key is GONE. FORTRESS does not integrate Aave on
///         Monad. Aave V3 exists on Monad but integrating it needs explicit
///         operator instruction (port prompt §3.4).
///      2. The `"Morpho"` key now points at the MetaMorpho **hyperUSDCa** vault,
///         whose `asset()` is USDC — verified on-chain. The Base target
///         (Moonwell USDC) has no code on Monad.
///      3. The DEX allowlist is rebuilt from Monad venues. The Base list (Odos,
///         BaseSwap) is discarded — see the collision warning in MonadAddresses.
///
///      NOTE: `LiFiAdapter` and `FortSwapRouter` now target GenericSwapFacetV3
///      (Phase 4, DECISIONS.md D0-5). Their swap paths still revert after this
///      script runs, but for a different and deliberate reason: the I5 selector
///      allowlist ships EMPTY and fails closed. See step 7.
contract DeployMonad is Script {
    function run() external {
        // Guard against deploying to the wrong chain with the right script.
        require(
            block.chainid == MonadAddresses.CHAIN_ID || block.chainid == MonadAddresses.TESTNET_CHAIN_ID, "not Monad"
        );

        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);

        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("Keeper:", keeper);

        vm.startBroadcast(deployerPk);

        // ═══════════════════════════════════════════════
        //  1. FortVault (UUPS proxy)
        // ═══════════════════════════════════════════════
        FortVault vaultImpl = new FortVault();
        ERC1967Proxy vaultProxy =
            new ERC1967Proxy(address(vaultImpl), abi.encodeCall(FortVault.initialize, (MonadAddresses.USDC)));
        FortVault vault = FortVault(address(vaultProxy));
        console.log("FortVault impl:", address(vaultImpl));
        console.log("FortVault proxy:", address(vaultProxy));

        // ═══════════════════════════════════════════════
        //  2. LiFiAdapter (UUPS proxy)
        // ═══════════════════════════════════════════════
        LiFiAdapter lifiImpl = new LiFiAdapter(MonadAddresses.USDC, MonadAddresses.LIFI_DIAMOND);
        ERC1967Proxy lifiProxy = new ERC1967Proxy(
            address(lifiImpl), abi.encodeCall(LiFiAdapter.initialize, (deployer, address(vaultProxy)))
        );
        LiFiAdapter lifiAdapter = LiFiAdapter(payable(address(lifiProxy)));
        console.log("LiFiAdapter impl:", address(lifiImpl));
        console.log("LiFiAdapter proxy:", address(lifiProxy));

        // ═══════════════════════════════════════════════
        //  3. CrossChainRouter (UUPS proxy)
        // ═══════════════════════════════════════════════
        CrossChainRouter ccImpl = new CrossChainRouter(MonadAddresses.USDC, MonadAddresses.LIFI_DIAMOND);
        ERC1967Proxy ccProxy =
            new ERC1967Proxy(address(ccImpl), abi.encodeCall(CrossChainRouter.initialize, (keeper, deployer)));
        console.log("CrossChainRouter impl:", address(ccImpl));
        console.log("CrossChainRouter proxy:", address(ccProxy));

        // ═══════════════════════════════════════════════
        //  4. FortSwapRouter (UUPS proxy)
        // ═══════════════════════════════════════════════
        FortSwapRouter swapImpl = new FortSwapRouter(MonadAddresses.USDC, MonadAddresses.LIFI_DIAMOND);
        ERC1967Proxy swapProxy = new ERC1967Proxy(
            address(swapImpl), abi.encodeCall(FortSwapRouter.initialize, (deployer, address(vaultProxy)))
        );
        FortSwapRouter swapRouter = FortSwapRouter(address(swapProxy));
        console.log("FortSwapRouter impl:", address(swapImpl));
        console.log("FortSwapRouter proxy:", address(swapProxy));

        // ═══════════════════════════════════════════════
        //  5. Configure FortVault registry
        // ═══════════════════════════════════════════════
        // Hyperithm USDC Apex (MetaMorpho V2) — asset() == USDC, $61.5M TVL, 8.64%.
        // Currently AT CAP (maxDeposit == 0). Registered deliberately: FortVault's
        // capacity guard turns that into a clean, attributable ProtocolAtCapacity
        // revert, and the vault starts accepting deposits automatically if the
        // curator raises the cap — no redeploy or config change needed.
        vault.registerProtocol("Morpho", MonadAddresses.VAULT_HYPERITHM_USDC_APEX, true);

        // Venues with OPEN capacity today. Both are natively ERC-4626, so they need
        // no adapter — FortVault's isERC4626 fast path drives them directly.
        vault.registerProtocol("Curvance", MonadAddresses.CURVANCE_CUSDC, true);
        vault.registerProtocol("Euler", MonadAddresses.EULER_EVAULT_USDC, true);

        vault.registerProtocol("LiFi", address(lifiAdapter), false);

        // ═══════════════════════════════════════════════
        //  6. DEX address allowlist (I5, first half)
        // ═══════════════════════════════════════════════
        // Every address verified to hold code on chain 143 and cross-checked against
        // monad-crypto/protocols (Phase 2). The Base list (Odos, BaseSwap, LI.FI
        // sub-routers) is NOT carried over — see the collision warning in
        // src/config/MonadAddresses.sol.
        address[6] memory dexes = [
            MonadAddresses.LIFI_DIAMOND,
            MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2,
            MonadAddresses.OPENOCEAN_EXCHANGE_PROXY,
            MonadAddresses.EISEN_DIAMOND,
            MonadAddresses.MONORAIL_AGGREGATION_ROUTER,
            MonadAddresses.KURU_ROUTER
        ];
        for (uint256 i; i < dexes.length; i++) {
            lifiAdapter.setApprovedDex(dexes[i], true);
            swapRouter.setApprovedDex(dexes[i], true);
        }

        vm.stopBroadcast();

        // ═══════════════════════════════════════════════
        //  7. Selector allowlist (I5, second half) — NOT SET HERE
        // ═══════════════════════════════════════════════
        // `LiFiAdapter` and `FortSwapRouter` validate each LI.FI leg by call target
        // AND by the 4-byte selector inside its `callData`. The address half is set
        // above; the selector half is deliberately left empty, so every swap reverts
        // `UnauthorizedSelector` until an operator populates it.
        //
        // The selectors belong to the venues LI.FI routes THROUGH (KyberSwap,
        // OpenOcean, Eisen, Monorail, Kuru), not to the diamond, and each must be
        // read off a live li.quest quote on chain 143 and verified before it is
        // trusted. Guessing them here would be exactly the "copied, not verified"
        // failure that the BaseSwap address collision already punished once.
        console.log("");
        console.log("!! ACTION REQUIRED: LI.FI selector allowlist is EMPTY.");
        console.log("!! Swaps revert UnauthorizedSelector until setApprovedSwapSelector()");
        console.log("!! is called on BOTH the LiFiAdapter and the FortSwapRouter proxies.");
        console.log("");

        console.log("--------- Deployment Complete ---------");
        console.log("FortVault (proxy)       :", address(vaultProxy));
        console.log("LiFiAdapter (proxy)     :", address(lifiProxy));
        console.log("CrossChainRouter (proxy):", address(ccProxy));
        console.log("FortSwapRouter (proxy)  :", address(swapProxy));
        console.log("---------------------------------------");
        console.log("Adapter slots 3/4/5 reserved and EMPTY - see src/adapters/PENDING.md");
    }
}
