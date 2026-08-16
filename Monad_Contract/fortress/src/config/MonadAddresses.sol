// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title MonadAddresses
/// @notice Single source of truth for every third-party address on Monad mainnet.
///
/// @dev **This is the ONLY file in `src/` or `script/` permitted to contain a
///      40-hex address literal.** CI enforces this
///      (`.github/workflows/ci.yml` → `address-literals` job). Adding an address
///      anywhere else fails the build.
///
///      Every constant below was verified on-chain in Phase 0 with `eth_getCode`
///      plus at least one identity call, and cross-checked against the canonical
///      registry `monad-crypto/protocols/mainnet`. Verification evidence per
///      address is recorded in `ADDRESSES.md`.
///
///      Chain: Monad mainnet, chain ID 143. Verified at block ~96,415,816 on
///      2026-08-16. Re-verify before any Phase 9 deployment.
library MonadAddresses {
    /*//////////////////////////////////////////////////////////////
                                  CHAIN
    //////////////////////////////////////////////////////////////*/

    /// @notice Monad mainnet chain ID. Verified: `eth_chainId` → 143.
    uint256 internal constant CHAIN_ID = 143;

    /// @notice Monad testnet chain ID. Verified: `eth_chainId` → 10143.
    uint256 internal constant TESTNET_CHAIN_ID = 10143;

    /// @notice Measured block gas limit (`eth_getBlockByNumber(latest).gasLimit`).
    uint256 internal constant BLOCK_GAS_LIMIT = 150_000_000;

    /// @notice Documented and observed minimum base fee, in wei (100 gwei).
    /// @dev Monad charges on `gas_limit`, NOT `gas_used`. Every entry point must
    ///      ship a measured gas envelope — see `docs/gas-model.md` (Phase 3).
    uint256 internal constant MIN_BASE_FEE_WEI = 100 gwei;

    /*//////////////////////////////////////////////////////////////
                              NATIVE SENTINEL
    //////////////////////////////////////////////////////////////*/

    /// @notice Marker meaning "native MON, not an ERC-20", used across FORTRESS's
    ///         own APIs (`LiFiAdapter.swap`, the encoded adapter payloads).
    /// @dev Not a deployed contract — it lives here only because CI forbids 40-hex
    ///      literals anywhere else (`script/ci/check-address-literals.sh`).
    ///
    ///      It is the same 0xEeee… convention `SHMONAD.asset()` returns, so the
    ///      shMonad adapter and the LI.FI swap legs speak one dialect.
    ///
    ///      This is FORTRESS's marker, NOT LI.FI's. `LibSwap.SwapData` contents are
    ///      passed to the diamond byte-for-byte and never rewritten, so whatever
    ///      sentinel LI.FI uses internally is irrelevant to this codebase.
    ///      `address(0)` is deliberately NOT reused, so a zero-address bug still
    ///      reverts as a zero address instead of silently meaning "native".
    address internal constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /*//////////////////////////////////////////////////////////////
                                  TOKENS
    //////////////////////////////////////////////////////////////*/

    /// @notice Native Circle USDC. symbol()="USDC", decimals()=6.
    /// @dev 6 decimals matches Base, so all BPS math and fixed-point constants
    ///      port over unchanged. Confirmed on-chain, not assumed.
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    /// @notice symbol()="WETH", decimals()=18.
    address internal constant WETH = 0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242;

    /// @notice symbol()="WBTC", decimals()=8.
    address internal constant WBTC = 0x0555E30da8f98308EdB960aa94C0Db47230d2B9c;

    /// @notice symbol()="cbBTC", decimals()=8.
    address internal constant CBBTC = 0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b;

    /// @notice symbol()="USDT0", decimals()=6.
    address internal constant USDT0 = 0xe7cd86e13AC4309349F30B3435a9d337750fC82D;

    /// @notice Agora USD. symbol()="AUSD", decimals()=6.
    address internal constant AUSD = 0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a;

    /// @notice Wrapped MON. symbol()="WMON", decimals()=18.
    address internal constant WMON = 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A;

    /// @notice Lido Wrapped Staked ETH. symbol()="wstETH", decimals()=18.
    /// @dev Collateral in the USDC/wstETH and WETH/wstETH Morpho markets.
    address internal constant WSTETH = 0x10Aeaf63194db8d453d4D85a06E5eFE1dd0b5417;

    /// @notice Lombard Staked Bitcoin. symbol()="LBTC", decimals()=8.
    address internal constant LBTC = 0xecAc9C5F704e954931349Da37F60E39f515c11c1;

    /*//////////////////////////////////////////////////////////////
                    DEX / AGGREGATOR ROUTERS (Monad)
    //////////////////////////////////////////////////////////////*/
    //
    // Swap-leg allowlist targets. Every one verified to hold code on chain 143 and
    // cross-referenced against monad-crypto/protocols. These replace the Base
    // venues (Odos, BaseSwap) wholesale — see the WARNING block below.
    //
    // Per invariant I5, an address allowlist alone is NOT sufficient: each of these
    // must also carry a function-selector allowlist. Selector sets are built per
    // adapter in Phase 4.

    /// @notice KyberSwap MetaAggregationRouterV2. code 13,724 B.
    /// @dev Same address as the Base deployment — KyberSwap reuses it across
    ///      chains. Verified on Monad anyway rather than assumed.
    address internal constant KYBERSWAP_META_AGGREGATION_ROUTER_V2 = 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5;

    /// @notice OpenOcean ExchangeProxy. code 2,161 B.
    address internal constant OPENOCEAN_EXCHANGE_PROXY = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;

    /// @notice Eisen Diamond. code 935 B.
    address internal constant EISEN_DIAMOND = 0x787C474B8A86354d0F5f19FB599a5FC7662A265f;

    /// @notice Monorail AggregationRouter. code 130 B.
    address internal constant MONORAIL_AGGREGATION_ROUTER = 0xA68A7F0601effDc65C64d9C47cA1b18D96B4352c;

    /// @notice Kuru Router (CLOB). code 141 B.
    address internal constant KURU_ROUTER = 0xd651346d7c789536ebf06dc72aE3C8502cd695CC;

    /// @notice Uniswap V2 Router02 on Monad. code 21,902 B.
    address internal constant UNISWAP_V2_ROUTER_02 = 0x4B2ab38DBF28D31D467aA8993f6c2585981D6804;

    // ─────────────────────────────────────────────────────────────────────────
    // WARNING — ADDRESS COLLISION. Do not reintroduce these Base addresses.
    //
    //   Odos router (Base)     0xC18D9E84b8687A2645447A61e52c455Dac1675e1  no code on Monad
    //   Morpho Blue (Base)     0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb  no code on Monad
    //   Moonwell USDC (Base)   0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca  no code on Monad
    //   Aave stataUSDC (Base)  0xC768c589647798a6EE01A91FdE98EF2ed046DBD6  no code on Monad
    //   Pendle LPWrapper(Base) 0xCa274A44a52241c1a8EFb9f84Bf492D8363929FC  no code on Monad
    //
    //   BaseSwap router (Base) 0x20F6ee51340aDEed01A59B0e65cB3703f3dc860c
    //       *** HAS 8,679 BYTES OF CODE ON MONAD, AND IT IS NOT BASESWAP. ***
    //       name(), symbol(), factory() and WETH() all revert; only owner()
    //       responds (0x9f2efccb4041236c7b683521de9459958977f694). It is an
    //       unrelated contract occupying the same address. Carrying the Base
    //       DEX allowlist over unchanged would have allowlisted an unknown
    //       contract as a swap target. This is why every address is re-verified
    //       on-chain rather than copied (port prompt §7).
    // ─────────────────────────────────────────────────────────────────────────

    /*//////////////////////////////////////////////////////////////
                                  MORPHO
    //////////////////////////////////////////////////////////////*/

    /// @notice Morpho Blue singleton.
    /// @dev Identity proven four ways: `DOMAIN_SEPARATOR()` non-zero,
    ///      `owner()` matches the registry's Safe entry, and four independent
    ///      periphery contracts each return this address from `MORPHO()`.
    ///      `flashLoan(address,uint256,bytes)` (0xe0232b42) confirmed present in
    ///      runtime bytecode, and the callback `onMorphoFlashLoan(uint256,bytes)`
    ///      (0x31f57072) matches `IMorphoBlue.IMorphoFlashLoanCallback` exactly.
    address internal constant MORPHO_BLUE = 0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee;

    /// @notice `MORPHO()` → MORPHO_BLUE.
    address internal constant MORPHO_ADAPTIVE_CURVE_IRM = 0x09475a3D6eA8c314c592b1a3799bDE044E2F400F;

    /// @notice `MORPHO()` → MORPHO_BLUE.
    address internal constant MORPHO_METAMORPHO_V1_1_FACTORY = 0x33f20973275B2F574488b18929cd7DCBf1AbF275;

    /// @notice `MORPHO()` → MORPHO_BLUE.
    address internal constant MORPHO_PUBLIC_ALLOCATOR = 0xfd70575B732F9482F4197FE1075492e114E97302;

    /// @notice `MORPHO()` → MORPHO_BLUE.
    address internal constant MORPHO_PRE_LIQUIDATION_FACTORY = 0xB5b3e541abD19799E0c65905a5a42BD37d6c94c0;

    address internal constant MORPHO_CHAINLINK_ORACLE_V2_FACTORY = 0xC8659Bcd5279DB664Be973aEFd752a5326653739;

    address internal constant MORPHO_BUNDLER3 = 0x82b684483e844422FD339df0b67b3B111F02c66E;

    /*//////////////////////////////////////////////////////////////
                        METAMORPHO ERC-4626 VAULTS
    //////////////////////////////////////////////////////////////*/

    // ─────────────────────────────────────────────────────────────────────────
    // CORRECTION (Phase 4). Phase 0 recorded raw `totalAssets()` integers and read
    // them as USD magnitudes. They are 6-decimal USDC units. The MetaMorpho V1.1
    // vaults it named as "live targets" are dust:
    //     hyperUSDCa  "23,259,775"     => $23.26      (NOT $23M)
    //     bbqAUSD     "13,106,242,214" => $13,095     (NOT $13.1B)
    // Phase 0 also enumerated only `vaults` (V1.1) from the Morpho API and missed
    // `vaultV2s` entirely. ALL meaningful Monad Morpho TVL is in MetaMorpho V2.
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice MetaMorpho V1.1 hyperUSDCa. asset()=USDC.
    /// @dev DUST: totalAssets() == $23.26. Retained only so the corrected value is
    ///      on the record. Do NOT register as a live target.
    address internal constant VAULT_V1_HYPER_USDCA = 0xA8665084D8CD6276c00CA97Cbc0BF4BC9ae94c79;

    /// @notice MetaMorpho V1.1 bbqUSDC. asset()=USDC, ~$11,922, 8.37% netAPY.
    /// @dev Largest USDC-denominated V1.1 vault, and still small.
    address internal constant VAULT_V1_BBQ_USDC = 0x802c91d807A8DaCA257c4708ab264B6520964e44;

    /*//////////////////////////////////////////////////////////////
                    METAMORPHO V2 VAULTS (the real TVL)
    //////////////////////////////////////////////////////////////*/
    //
    // WARNING: every one of these currently reports `maxDeposit() == 0` — they are
    // AT CAP, not gated (all four V2 gate slots read address(0)). FortVault's
    // capacity guard (`ProtocolAtCapacity`) makes this a clean, attributable revert
    // instead of an anonymous one, and they begin accepting deposits automatically
    // if a curator raises the cap. Re-check capacity before relying on any of them.

    /// @notice "Hyperithm USDC Apex". asset()=USDC. $61.5M TVL, 8.64% netAPY.
    /// @dev The largest yield venue on Monad by a wide margin. AT CAP as of Phase 4.
    address internal constant VAULT_HYPERITHM_USDC_APEX = 0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371;

    /// @notice "August USDC V2". asset()=USDC. $3.92M TVL, 8.32% netAPY. AT CAP.
    address internal constant VAULT_AUGUST_USDC_V2 = 0x80017bF0f793EBbE9679Cd61ff0e395B62CAbB59;

    /// @notice "Saturn USDC". asset()=USDC. $1.81M TVL, 5.80% netAPY. AT CAP.
    address internal constant VAULT_SATURN_USDC = 0x75753e494e5e374C52E1d84fc04EB14B10F2C079;

    /*//////////////////////////////////////////////////////////////
              ERC-4626 VENUES WITH OPEN CAPACITY (usable today)
    //////////////////////////////////////////////////////////////*/
    //
    // These need NO adapter: FortVault's `isERC4626` fast path drives them directly.

    /// @notice Curvance cUSDC. asset()=USDC (exact match), maxDeposit UNCAPPED.
    /// @dev Verified on-chain: convertToShares(1 USDC) = 990,003. TVL ~$765 — small,
    ///      but genuinely open, unlike every Morpho V2 vault.
    address internal constant CURVANCE_CUSDC = 0x21aDBb60a5fB909e7F1fB48aACC4569615CD97b5;

    /// @notice Euler eVault, USDC. $1.43M TVL with ~$6.57M of remaining capacity.
    /// @dev Largest USDC venue on Monad that can actually accept a deposit right now.
    ///      Euler eVaults are natively ERC-4626. Found by scanning all 134 proxies from
    ///      eVaultFactory 0xba4dd672062de8feedb665dd4410658864483f1e; 10 are USDC.
    address internal constant EULER_EVAULT_USDC = 0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0;

    /// @notice Euler eVault, USDC. $36k TVL, ~$35.96M remaining capacity.
    address internal constant EULER_EVAULT_USDC_DEEP = 0x5792753b66Eb5213E416755546abBcC1AEF1008A;

    /// @notice symbol()="bbqAUSD", asset()=AUSD. ~$13,095. Not USDC-denominated.
    address internal constant VAULT_BBQ_AUSD = 0xBC03E505EE65f9fAa68a2D7e5A74452858C16D29;

    /// @notice symbol()="steakETH", asset()=WETH. ~$219.
    address internal constant VAULT_STEAK_ETH = 0xba8424EBBEd6C51bEa6d6D903B8815838E6a0322;

    /// @notice symbol()="naUSDC", asset()=USDC. Effectively empty.
    address internal constant VAULT_NA_USDC = 0xf5BC68C6e5825FEAe99B8018F62a595Cf745e297;

    /*//////////////////////////////////////////////////////////////
                    LENDING (adapter required, not ERC-4626)
    //////////////////////////////////////////////////////////////*/

    //
    // Integrated in Phase 4 task 12 under explicit operator instruction (port
    // prompt §3.4). `AaveV3Adapter` serves both markets — one implementation, two
    // deployments, differing only in the (pool, aToken) pair below.
    //
    // The two markets are NOT the same Aave revision. Verified live:
    //     Aave V3 Monad        POOL_REVISION() = 11   (v3.2+, no stable debt token)
    //     Neverland Market V3  POOL_REVISION() = 2    (v3.0.x, stable debt present)
    // `supply`, `withdraw` and `getConfiguration` behave identically on both;
    // `getReserveData`'s struct does not. See `src/interfaces/IAaveV3Pool.sol`.

    /// @notice Aave V3 Pool proxy. `getMarketId()` = "Aave V3 Monad".
    /// @dev Cross-confirmed two ways: `AAVE_V3_A_USDC.POOL()` returns this, and
    ///      `AAVE_V3_POOL_ADDRESSES_PROVIDER.getPool()` returns this.
    address internal constant AAVE_V3_POOL = 0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef;

    /// @notice Aave V3 PoolAddressesProvider. `AAVE_V3_POOL.ADDRESSES_PROVIDER()`
    ///         returns this, closing the loop.
    address internal constant AAVE_V3_POOL_ADDRESSES_PROVIDER = 0x34793Fb9935F7bB5E5aE920fb963F39063E7A615;

    /// @notice Aave V3 aMonUSDC. symbol()="aMonUSDC", decimals()=6,
    ///         UNDERLYING_ASSET_ADDRESS()=USDC.
    /// @dev NOT ERC-4626 — asset(), totalAssets() and maxDeposit() all revert.
    ///      aTokens rebase, so `FortVault`'s isERC4626 fast path cannot drive this.
    ///
    ///      THE LARGEST USABLE USDC VENUE ON MONAD. $141.7M supplied against a
    ///      250M supply cap — ~108M of open capacity, versus Euler's ~6.6M and a
    ///      Morpho V2 tier that is entirely at cap. Supply APR 3.07% at Phase 4.
    address internal constant AAVE_V3_A_USDC = 0x35a73BAcb179d3740395A3ceCc87FF2e581d6042;

    /// @notice Aave V3 Protocol Data Provider on Monad.
    /// @dev Recorded for provenance only. The adapter does NOT call it: in Aave V3
    ///      the data provider is a plain contract that is REPLACED on upgrade,
    ///      unlike the Pool and aToken proxies. Reserve state is read from the
    ///      Pool's own configuration bitmap instead.
    address internal constant AAVE_V3_DATA_PROVIDER = 0xB65A68B98274ef7D9a60E0C0747dD1BEc3D32fad;

    /// @notice Neverland Pool proxy. `getMarketId()` = "Neverland Market V3".
    /// @dev `NEVERLAND_A_USDC.POOL()` returns this, and the Pool's
    ///      `ADDRESSES_PROVIDER()` returns NEVERLAND_POOL_ADDRESSES_PROVIDER.
    address internal constant NEVERLAND_POOL = 0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585;

    /// @notice Neverland PoolAddressesProvider.
    /// @dev Neverland is an Aave V3 FORK — identical ACLManager /
    ///      PoolAddressesProvider / ConfiguratorLogic / EModeLogic layout. One
    ///      adapter therefore serves both venues; only the pool address differs.
    address internal constant NEVERLAND_POOL_ADDRESSES_PROVIDER = 0x49D75170F55C964dfdd6726c74fdEDEe75553A0f;

    /// @notice Neverland aToken for USDC. symbol()="nUSDC", decimals()=6,
    ///         UNDERLYING_ASSET_ADDRESS()=USDC.
    /// @dev $2.72M supplied against a 90M cap. Supply APR 1.91%, and note the
    ///      reserve factor is 4000 bps — 40% of interest goes to the Neverland
    ///      treasury, against Aave's 1000 bps. Materially worse yield for the same
    ///      asset; registered so the operator can choose, not because it is better.
    address internal constant NEVERLAND_A_USDC = 0x38648958836eA88b368b4ac23b86Ad44B0fe7508;

    /// @notice Neverland PoolDataProvider.
    /// @dev Provenance only — see the note on AAVE_V3_DATA_PROVIDER.
    address internal constant NEVERLAND_DATA_PROVIDER = 0xfd0b6b6F736376F7B99ee989c749007c7757fDba;

    /*//////////////////////////////////////////////////////////////
                              LST — shMONAD
    //////////////////////////////////////////////////////////////*/

    /// @notice FastLane shMONAD. symbol()="shMON", maxDeposit UNCAPPED.
    /// @dev ERC-4626 shaped, but `asset()` returns the native-MON sentinel
    ///      0xEeee…EEeE, not an ERC-20. FortVault's fast path does
    ///      `IERC20(asset).transferFrom`, which cannot work against a sentinel — so
    ///      this needs a dedicated adapter with a USDC->MON swap leg, NOT the
    ///      `isERC4626` path.
    address internal constant SHMONAD = 0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c;

    /*//////////////////////////////////////////////////////////////
                                  PENDLE
    //////////////////////////////////////////////////////////////*/

    /// @notice Pendle Router V4 (diamond).
    /// @dev Same singleton address as Base — verified anyway per prompt §7, not
    ///      assumed. All three selectors our `IPendleRouter` declares are routed:
    ///      swapExactTokenForPt 0xc81f847a, swapExactPtForToken 0x594a88cc,
    ///      redeemPyToToken 0x47f1de22. Unknown selectors revert INVALID_SELECTOR.
    address internal constant PENDLE_ROUTER_V4 = 0x888888888889758F76e7103c6CbF23ABbF58F946;

    address internal constant PENDLE_ROUTER_STATIC = 0x6813d43782395A1F2AAb42f39aeEDE03ac655e09;
    address internal constant PENDLE_MARKET_FACTORY_V6 = 0xA3cb62a49b66eB2536cf6F3C7AC82293784888A3;
    address internal constant PENDLE_SWAP = 0xd4F480965D2347d421F1bEC7F545682E5Ec2151D;
    address internal constant PENDLE_LIMIT_ROUTER = 0x000000000000c9B3E2C3Ec88B1B4c0cD853f4321;
    address internal constant PENDLE_YIELD_CONTRACT_FACTORY = 0x4fe1B23ab695D99394Ab78c16A5bE358f31847F4;
    address internal constant PENDLE_PY_LP_ORACLE = 0x5542be50420E88dd7D5B4a3D488FA6ED82F6DAc2;
    address internal constant PENDLE_SY_FACTORY = 0x466CeD3b33045Ea986B2f306C8D0aA8067961CF8;

    /*//////////////////////////////////////////////////////////////
                                   LI.FI
    //////////////////////////////////////////////////////////////*/

    /// @notice LI.FI Diamond on Monad.
    /// @dev NOT the Base address `0x1231DEB6…`, which has NO CODE on Monad.
    ///      Verified three ways: on-chain code + `owner()`, the canonical registry
    ///      (`li_fi.jsonc` → "Li.Fi"), and a live li.quest quote returning this as
    ///      `transactionRequest.to`.
    ///
    ///      WARNING: this diamond does NOT expose `swapTokensGeneric` (0x4630a0d8).
    ///      It ships GenericSwapFacetV3. `LiFiAdapter` must be rewritten against
    ///      the V3 selectors below — see DECISIONS.md D0-5.
    address internal constant LIFI_DIAMOND = 0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37;

    address internal constant LIFI_PERMIT2_PROXY = 0x3c6B2E0b7421254846C53c118e24c65d59eAe75e;

    /// @notice GenericSwapFacetV3 implementation behind LIFI_DIAMOND.
    /// @dev Recorded for allowlist provenance; calls always target the diamond.
    address internal constant LIFI_GENERIC_SWAP_FACET_V3 = 0xe850dad9b442b1A7DF8FbbD397dbb7466379A9E8;

    /*//////////////////////////////////////////////////////////////
                    LI.FI GenericSwapFacetV3 SELECTORS
    //////////////////////////////////////////////////////////////*/

    bytes4 internal constant LIFI_SWAP_SINGLE_ERC20_TO_ERC20 = 0x4666fc80;
    bytes4 internal constant LIFI_SWAP_SINGLE_ERC20_TO_NATIVE = 0x733214a3;
    bytes4 internal constant LIFI_SWAP_SINGLE_NATIVE_TO_ERC20 = 0xaf7060fd;
    bytes4 internal constant LIFI_SWAP_MULTIPLE_ERC20_TO_ERC20 = 0x5fd9ae2e;
    bytes4 internal constant LIFI_SWAP_MULTIPLE_ERC20_TO_NATIVE = 0x2c57e884;
    bytes4 internal constant LIFI_SWAP_MULTIPLE_NATIVE_TO_ERC20 = 0x736eac0b;

    /*//////////////////////////////////////////////////////////////
                              INFRASTRUCTURE
    //////////////////////////////////////////////////////////////*/

    address internal constant MULTICALL3 = 0xcA11bde05977b3631167028862bE2a173976CA11;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant CREATEX = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;
    address internal constant FOUNDRY_DETERMINISTIC_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    /// @notice Morpho governance Safe, per the canonical registry.
    /// @dev Equals the on-chain `Morpho.owner()`.
    address internal constant MORPHO_GOVERNANCE_SAFE = 0xe27f43624FDb5325b853c4711BCF0fEBA754e558;
}
