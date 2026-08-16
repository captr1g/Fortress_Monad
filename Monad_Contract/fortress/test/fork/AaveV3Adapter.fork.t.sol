// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/adapters/AaveV3Adapter.sol";
import "../../src/interfaces/IAaveV3Pool.sol";
import "../../src/config/MonadAddresses.sol";
import "../helpers/MonadFork.sol";

/// @dev The revision accessor and the data-provider views used only to cross-check
///      the configuration bitmap. Deliberately not in `src/` — production code must
///      not depend on the data provider (it is replaced on upgrade, not proxied).
interface IPoolRevision {
    function POOL_REVISION() external view returns (uint256);
    function ADDRESSES_PROVIDER() external view returns (address);
}

interface IAaveDataProvider {
    function getReserveConfigurationData(address asset)
        external
        view
        returns (
            uint256 decimals,
            uint256 ltv,
            uint256 liquidationThreshold,
            uint256 liquidationBonus,
            uint256 reserveFactor,
            bool usageAsCollateralEnabled,
            bool borrowingEnabled,
            bool stableBorrowRateEnabled,
            bool isActive,
            bool isFrozen
        );
    function getReserveCaps(address asset) external view returns (uint256 borrowCap, uint256 supplyCap);
    function getPaused(address asset) external view returns (bool);
}

/// @title AaveV3Adapter fork tests — both live Monad markets
///
/// @notice Phase 4 task 12. Runs the same adapter implementation against `Aave V3
///         Monad` and the `Neverland Market V3` fork, at the pinned block.
///
/// @dev The load-bearing test here is `test_fork_configBitmapMatchesDataProvider`.
///      `AaveV3Adapter` reads reserve state out of the Pool's packed configuration
///      word rather than through the data provider, on the claim that the bit
///      layout for active / frozen / paused / supply cap is identical across the
///      two revisions these markets run — 11 and 2. That claim is asserted, per
///      market, by decoding the bitmap and comparing every field against the
///      market's own data provider. If either market ever moves a bit, this fails
///      rather than the adapter silently misreading a reserve as open.
///
///      Excluded from the default CI run (`--no-match-path "test/fork/*"`); needs
///      `MONAD_RPC_URL`.
contract AaveV3AdapterForkTest is Test, MonadFork {
    using LibAaveReserve for uint256;

    AaveV3Adapter internal aave;
    AaveV3Adapter internal neverland;

    address internal owner = address(this);
    address internal vault = address(0xBA);
    address internal user = address(0xA1);

    function setUp() public {
        _forkMonad();
        aave = _deploy(MonadAddresses.AAVE_V3_POOL, MonadAddresses.AAVE_V3_A_USDC);
        neverland = _deploy(MonadAddresses.NEVERLAND_POOL, MonadAddresses.NEVERLAND_A_USDC);
    }

    function _deploy(address pool, address aToken) internal returns (AaveV3Adapter) {
        AaveV3Adapter impl = new AaveV3Adapter(MonadAddresses.USDC, pool, aToken);
        return AaveV3Adapter(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(AaveV3Adapter.initialize, (owner, vault))))
        );
    }

    /*//////////////////////////////////////////////////////////////
                            MARKET IDENTITY
    //////////////////////////////////////////////////////////////*/

    function test_fork_marketIds() public view {
        assertEq(IPoolAddressesProvider(MonadAddresses.AAVE_V3_POOL_ADDRESSES_PROVIDER).getMarketId(), "Aave V3 Monad");
        assertEq(
            IPoolAddressesProvider(MonadAddresses.NEVERLAND_POOL_ADDRESSES_PROVIDER).getMarketId(),
            "Neverland Market V3"
        );
    }

    /// @notice Each provider resolves to the pool recorded in the address book, and
    ///         each pool points back at its provider. Neither is taken on faith.
    function test_fork_providerPoolLoopCloses() public view {
        assertEq(
            IPoolAddressesProvider(MonadAddresses.AAVE_V3_POOL_ADDRESSES_PROVIDER).getPool(),
            MonadAddresses.AAVE_V3_POOL
        );
        assertEq(
            IPoolRevision(MonadAddresses.AAVE_V3_POOL).ADDRESSES_PROVIDER(),
            MonadAddresses.AAVE_V3_POOL_ADDRESSES_PROVIDER
        );
        assertEq(
            IPoolAddressesProvider(MonadAddresses.NEVERLAND_POOL_ADDRESSES_PROVIDER).getPool(),
            MonadAddresses.NEVERLAND_POOL
        );
        assertEq(
            IPoolRevision(MonadAddresses.NEVERLAND_POOL).ADDRESSES_PROVIDER(),
            MonadAddresses.NEVERLAND_POOL_ADDRESSES_PROVIDER
        );
    }

    /// @notice The two markets are NOT the same Aave revision. This is why
    ///         `IAaveV3Pool` declares no `getReserveData`.
    function test_fork_revisionsDiffer() public view {
        uint256 aaveRev = IPoolRevision(MonadAddresses.AAVE_V3_POOL).POOL_REVISION();
        uint256 nevRev = IPoolRevision(MonadAddresses.NEVERLAND_POOL).POOL_REVISION();
        assertEq(aaveRev, 11, "Aave V3 Monad revision");
        assertEq(nevRev, 2, "Neverland revision");
        assertTrue(aaveRev != nevRev, "the whole reason the ABI slice is minimal");
    }

    /// @notice The constructor's wiring proof holds against the real aTokens.
    function test_fork_wiringIsSelfConsistent() public view {
        assertEq(IAToken(MonadAddresses.AAVE_V3_A_USDC).POOL(), MonadAddresses.AAVE_V3_POOL);
        assertEq(IAToken(MonadAddresses.AAVE_V3_A_USDC).UNDERLYING_ASSET_ADDRESS(), MonadAddresses.USDC);
        assertEq(IAToken(MonadAddresses.NEVERLAND_A_USDC).POOL(), MonadAddresses.NEVERLAND_POOL);
        assertEq(IAToken(MonadAddresses.NEVERLAND_A_USDC).UNDERLYING_ASSET_ADDRESS(), MonadAddresses.USDC);
    }

    /// @notice Crossing the markets must be impossible to deploy.
    function test_fork_crossedWiring_reverts() public {
        vm.expectRevert(AaveV3Adapter.WiringMismatch.selector);
        new AaveV3Adapter(MonadAddresses.USDC, MonadAddresses.AAVE_V3_POOL, MonadAddresses.NEVERLAND_A_USDC);
    }

    /*//////////////////////////////////////////////////////////////
                    THE BITMAP CLAIM, ASSERTED PER MARKET
    //////////////////////////////////////////////////////////////*/

    function test_fork_configBitmapMatchesDataProvider() public view {
        _assertBitmapMatches(MonadAddresses.AAVE_V3_POOL, MonadAddresses.AAVE_V3_DATA_PROVIDER, "aave");
        _assertBitmapMatches(MonadAddresses.NEVERLAND_POOL, MonadAddresses.NEVERLAND_DATA_PROVIDER, "neverland");
    }

    function _assertBitmapMatches(address pool, address dataProvider, string memory what) internal view {
        uint256 config = IAaveV3Pool(pool).getConfiguration(MonadAddresses.USDC);
        IAaveDataProvider dp = IAaveDataProvider(dataProvider);

        (uint256 decimals,,,,,,,, bool isActive, bool isFrozen) = dp.getReserveConfigurationData(MonadAddresses.USDC);
        (, uint256 supplyCap) = dp.getReserveCaps(MonadAddresses.USDC);

        assertEq(config.decimals(), decimals, string.concat(what, ": decimals bit field"));
        assertEq(config.isActive(), isActive, string.concat(what, ": active bit"));
        assertEq(config.isFrozen(), isFrozen, string.concat(what, ": frozen bit"));
        assertEq(config.isPaused(), dp.getPaused(MonadAddresses.USDC), string.concat(what, ": paused bit"));
        assertEq(config.supplyCap(), supplyCap, string.concat(what, ": supply cap bit field"));
    }

    /*//////////////////////////////////////////////////////////////
                          LIVE RESERVE STATE
    //////////////////////////////////////////////////////////////*/

    /// @notice Both reserves must actually be able to take a deposit. Recorded
    ///         because the Morpho V2 tier looked live and was entirely at cap.
    function test_fork_bothMarketsHaveOpenCapacity() public {
        uint256 aaveCapacity = aave.availableCapacity();
        uint256 nevCapacity = neverland.availableCapacity();

        emit log_named_decimal_uint("Aave USDC capacity     ", aaveCapacity, 6);
        emit log_named_decimal_uint("Neverland USDC capacity", nevCapacity, 6);

        assertGt(aaveCapacity, 1_000_000e6, "Aave should have well over 1M of headroom");
        assertGt(nevCapacity, 1_000_000e6, "Neverland should have well over 1M of headroom");
    }

    /*//////////////////////////////////////////////////////////////
                          LIVE ROUND TRIPS
    //////////////////////////////////////////////////////////////*/

    function test_fork_aave_supplyAndWithdraw() public {
        _roundTrip(aave, MonadAddresses.AAVE_V3_A_USDC, 10_000e6);
    }

    function test_fork_neverland_supplyAndWithdraw() public {
        _roundTrip(neverland, MonadAddresses.NEVERLAND_A_USDC, 10_000e6);
    }

    /// @dev Full vault-shaped flow against the live pool: vault approves the
    ///      adapter, adapter supplies on the user's behalf, user approves the
    ///      adapter on the aToken, adapter redeems back to USDC.
    function _roundTrip(AaveV3Adapter adapter, address aTokenAddr, uint256 amount) internal {
        IERC20 usdc = IERC20(MonadAddresses.USDC);
        IERC20 aToken = IERC20(aTokenAddr);

        deal(MonadAddresses.USDC, vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        uint256 position = aToken.balanceOf(user);
        assertApproxEqAbs(position, amount, 1, "user credited on the live pool");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1: adapter holds no position");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1: adapter holds no underlying");

        vm.prank(user);
        aToken.approve(address(adapter), position);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(position, user, user);

        assertApproxEqAbs(usdcOut, amount, 1, "principal returned from the live pool");
        assertEq(usdc.balanceOf(user), usdcOut, "I2: delivered to the receiver");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice Interest actually accrues on the live market — the position is not a
    ///         static balance, which is the reason this needs an adapter at all.
    function test_fork_aave_positionAccrues() public {
        IERC20 usdc = IERC20(MonadAddresses.USDC);
        IERC20 aToken = IERC20(MonadAddresses.AAVE_V3_A_USDC);
        uint256 amount = 1_000_000e6;

        deal(MonadAddresses.USDC, vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(aave), amount);
        aave.depositFor(amount, user);
        vm.stopPrank();

        uint256 before = aToken.balanceOf(user);
        vm.warp(block.timestamp + 365 days);
        uint256 grown = aToken.balanceOf(user);

        assertGt(grown, before, "aToken balance rebases upward with the index");
        emit log_named_decimal_uint("1y accrual on 1M USDC", grown - before, 6);
    }
}
