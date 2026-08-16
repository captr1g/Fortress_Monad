// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../src/FortVault.sol";
import "../src/CrossChainRouter.sol";
import "../src/FortSwapRouter.sol";
import "../src/adapters/LiFiAdapter.sol";
import "../src/adapters/AaveV3Adapter.sol";
import "../src/adapters/ShMonadAdapter.sol";
import "../src/config/MonadAddresses.sol";

/// @title DeployMonad — full FORTRESS protocol deployment on Monad (chain 143)
/// @notice Replaces the Base-targeted `DeployBase.s.sol`. Every third-party
///         address comes from `MonadAddresses`; none is written inline.
///
/// @dev Divergences from the Base deployment, all forced by Monad reality:
///
///      1. The `"Aave"` registry key is BACK, and `"Neverland"` joins it (Phase 4
///         task 12). Both were added under explicit operator instruction, which is
///         what port prompt §3.4 requires before integrating a protocol that
///         merely exists on the chain. One `AaveV3Adapter` implementation serves
///         both markets; they differ only in their (pool, aToken) pair.
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
        // MAINNET ONLY. Testnet 10143 is deliberately rejected.
        //
        // Every address in MonadAddresses was verified against mainnet 143 and NONE
        // of them exists on testnet — USDC, the Aave pool, Curvance, Euler, shMONAD
        // and the LI.FI diamond all return empty code on 10143. Allowing testnet
        // here implied a rehearsal environment that does not exist: the run would
        // revert partway through (AaveV3Adapter's constructor calls aToken.POOL()
        // against an address with no code), and anything registered before that
        // point would point at dead addresses.
        require(
            block.chainid == MonadAddresses.CHAIN_ID, "DeployMonad: mainnet 143 only - no protocol exists on testnet"
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
        //  2b. AaveV3Adapter x2 — Aave V3 Monad and Neverland
        // ═══════════════════════════════════════════════
        // Two implementation deployments, not one shared implementation: `pool` and
        // `aToken` are immutables, which keeps them out of storage and off the hot
        // path. On Monad a cold SLOAD is ~8,100 gas, so putting the pool in storage
        // would tax every deposit and withdraw for the life of the deployment.
        //
        // Each constructor proves its own wiring on chain — it reads the aToken's
        // POOL() and UNDERLYING_ASSET_ADDRESS() and reverts WiringMismatch if the
        // triple disagrees. Crossing the two markets cannot be deployed.
        AaveV3Adapter aaveImpl =
            new AaveV3Adapter(MonadAddresses.USDC, MonadAddresses.AAVE_V3_POOL, MonadAddresses.AAVE_V3_A_USDC);
        ERC1967Proxy aaveProxy = new ERC1967Proxy(
            address(aaveImpl), abi.encodeCall(AaveV3Adapter.initialize, (deployer, address(vaultProxy)))
        );
        console.log("AaveV3Adapter (Aave) proxy:", address(aaveProxy));

        AaveV3Adapter neverlandImpl =
            new AaveV3Adapter(MonadAddresses.USDC, MonadAddresses.NEVERLAND_POOL, MonadAddresses.NEVERLAND_A_USDC);
        ERC1967Proxy neverlandProxy = new ERC1967Proxy(
            address(neverlandImpl), abi.encodeCall(AaveV3Adapter.initialize, (deployer, address(vaultProxy)))
        );
        console.log("AaveV3Adapter (Neverland) proxy:", address(neverlandProxy));

        // ═══════════════════════════════════════════════
        //  2c. ShMonadAdapter — USDC <-> MON <-> shMON
        // ═══════════════════════════════════════════════
        // Routes its MON leg through the LiFiAdapter proxy above rather than
        // re-implementing route validation, so there is one selector allowlist to
        // maintain, not two. That also means shMONAD deposits stay closed until the
        // LiFiAdapter selector allowlist is populated — see step 7.
        //
        // The constructor asserts shMONAD.asset() is the native sentinel; if
        // FastLane ever repoints it at an ERC-20 this deployment fails here.
        ShMonadAdapter shMonadImpl = new ShMonadAdapter(MonadAddresses.USDC, MonadAddresses.SHMONAD, address(lifiProxy));
        ERC1967Proxy shMonadProxy = new ERC1967Proxy(
            address(shMonadImpl), abi.encodeCall(ShMonadAdapter.initialize, (deployer, address(vaultProxy)))
        );
        console.log("ShMonadAdapter proxy:", address(shMonadProxy));

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

        // Aave V3 Monad: the largest USABLE USDC venue on the chain. ~$141.7M
        // supplied against a 250M cap, so ~108M of open capacity — against Euler's
        // ~6.6M and a Morpho V2 tier that is entirely at cap. Supply APR 3.07%.
        //
        // Neverland is the same Aave V3 codebase at an older revision, with ~87M of
        // headroom but a 4000 bps reserve factor against Aave's 1000 — 40% of the
        // interest goes to its treasury, and the supply APR is 1.91%. Registered so
        // the operator can choose it, not because it is the better venue.
        //
        // isERC4626 = false for both: aTokens rebase, and Aave's asset(),
        // totalAssets() and maxDeposit() all revert.
        // FastLane liquid staking. isERC4626 = false: shMONAD is ERC-4626 shaped but
        // its asset() is the native-MON sentinel, and its deposit() is payable, so
        // the fast path's IERC20(asset).transferFrom cannot drive it.
        //
        // NOTE FOR CALLERS: the exit carries a real haircut — 64 bps measured live at
        // the pinned block. Size minMonOut off ShMonadAdapter.previewRedeemMon(),
        // never off convertToAssets().
        vault.registerProtocol("shMONAD", address(shMonadProxy), false);

        vault.registerProtocol("Aave", address(aaveProxy), false);
        vault.registerProtocol("Neverland", address(neverlandProxy), false);

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
        console.log("ShMonadAdapter          :", address(shMonadProxy));
        console.log("AaveV3Adapter Aave      :", address(aaveProxy));
        console.log("AaveV3Adapter Neverland :", address(neverlandProxy));
        console.log("CrossChainRouter (proxy):", address(ccProxy));
        console.log("FortSwapRouter (proxy)  :", address(swapProxy));
        console.log("---------------------------------------");
        console.log("Adapter slots 3/4/5 reserved and EMPTY - see src/adapters/PENDING.md");
    }
}
