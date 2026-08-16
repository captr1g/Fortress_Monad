// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../../src/interfaces/IOracle.sol";
import "../helpers/MonadFork.sol";

/// @notice Real Morpho Blue (Base mainnet) tests for the oracle-based borrow.
///         These cover the three things the mock cannot: the real oracle's price
///         scaling, real share<->asset (interest) conversion of existing debt, and
///         Morpho's own LLTV health revert. The adapter is exercised directly with
///         the test contract acting as the executor.
interface IMorphoBlueExtended {
    function idToMarketParams(bytes32 id)
        external
        view
        returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv);

    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);

    function setAuthorization(address authorized, bool newIsAuthorized) external;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract MorphoStrategyAdapterForkTest is Test, MonadFork {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;

    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    bytes32 constant MARKET_ID = 0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137;

    MorphoStrategyAdapter internal adapter;
    IMorphoBlue.MarketParams internal market;

    // The test contract is the executor (so it can call adapter.execute directly).
    address internal user = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);

        (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) =
            IMorphoBlueExtended(MORPHO_BLUE).idToMarketParams(MARKET_ID);
        market = IMorphoBlue.MarketParams({
            loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv
        });

        // Executor == this test contract.
        MorphoStrategyAdapter adapterImpl = new MorphoStrategyAdapter(MORPHO_BLUE);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl), abi.encodeCall(MorphoStrategyAdapter.initialize, (address(this), address(this)))
        );
        adapter = MorphoStrategyAdapter(address(adapterProxy));

        // User authorizes the adapter to act on their Morpho position.
        vm.prank(user);
        IMorphoBlueExtended(MORPHO_BLUE).setAuthorization(address(adapter), true);
    }

    /// @dev Supply `amount` of real collateral on behalf of `user` through the adapter.
    function _supply(uint256 amount) internal {
        deal(market.collateralToken, address(adapter), amount);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL, market.collateralToken, amount, user, abi.encode(market)
        );
    }

    function _borrow(uint256 targetLtvWad, uint256 maxBorrow, uint256 minBorrow) internal returns (uint256 amountOut) {
        (, amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(market, targetLtvWad, maxBorrow, minBorrow)
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Real oracle sizing: borrow lands at the requested LTV
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_borrowSizesToTargetLtv_withRealOracle() public {
        uint256 collateral = 100e6; // 100 yoUSD (6dp on this market)
        _supply(collateral);

        uint256 price = IOracle(market.oracle).price();
        uint256 targetLtv = 0.1e18; // conservative to stay within market liquidity

        uint256 borrowed = _borrow(targetLtv, type(uint256).max, 0);

        // Expected = collateral * price / 1e36 * targetLtv / 1e18. Allow a small
        // tolerance for Morpho's internal share<->asset rounding on a live market.
        uint256 collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
        uint256 expected = (collateralValue * targetLtv) / WAD;
        assertApproxEqAbs(
            borrowed,
            expected,
            1e5, // 0.1 token tolerance (6dp)
            "borrow sized to target LTV via real oracle"
        );

        // The executor (this contract) received the borrowed funds. Allow a small
        // tolerance for Morpho's internal share<->asset rounding on a live market.
        assertApproxEqAbs(
            IERC20(market.loanToken).balanceOf(address(this)),
            borrowed,
            1e5, // 0.1 token tolerance (6dp)
            "executor received the borrowed funds"
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Real share->asset: a second borrow accounts for accrued existing debt
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_secondBorrowAccountsForExistingDebt() public {
        _supply(200e6);

        uint256 first = _borrow(0.05e18, type(uint256).max, 0); // borrow to 5%
        assertGt(first, 0);

        // Advance time so interest accrues on the real IRM, growing currentDebt.
        vm.warp(block.timestamp + 30 days);

        // Borrow to 10%: the adapter must read the (now larger) real debt via
        // share->asset conversion and only borrow the remaining gap.
        uint256 second = _borrow(0.1e18, type(uint256).max, 0);

        (, uint128 borrowShares, uint128 collateral) = IMorphoBlueExtended(MORPHO_BLUE).position(MARKET_ID, user);
        assertGt(borrowShares, 0, "debt exists");
        assertGt(collateral, 0, "collateral exists");
        // Second borrow is the gap to 10%, strictly less than borrowing 10% fresh.
        assertLt(second, first * 2, "second borrow only fills the gap");
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Real LLTV health revert: target near LLTV that Morpho rejects
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_borrowBeyondLiquidity_orHealth_reverts() public {
        // Supply a large collateral and target an LTV just under LLTV. The implied
        // borrow is huge and exceeds this market's available liquidity, so Morpho
        // itself reverts — and the whole call reverts atomically (no partial debt).
        _supply(10_000_000e6);

        uint256 nearLltv = market.lltv - 1e15; // LLTV - 0.1%

        vm.expectRevert();
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(market, nearLltv, type(uint256).max, uint256(0))
        );

        // Position debt unchanged (still zero) — atomic revert held.
        (, uint128 borrowShares,) = IMorphoBlueExtended(MORPHO_BLUE).position(MARKET_ID, user);
        assertEq(borrowShares, 0, "no debt created on revert");
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Real oracle: NoCollateral fires before any oracle/borrow work
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_noCollateral_reverts() public {
        vm.expectRevert(MorphoStrategyAdapter.NoCollateral.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(market, uint256(0.1e18), type(uint256).max, uint256(0))
        );
    }
}
