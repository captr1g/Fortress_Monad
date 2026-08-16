// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../interfaces/IStrategyAdapter.sol";
import "../interfaces/IMorphoBlue.sol";
import "../interfaces/IOracle.sol";

/// @title MorphoStrategyAdapter — adapter for Morpho Blue supply/borrow operations
/// @notice Called by FortStrategyExecutor. Acts onBehalf of the user (requires user to setAuthorization).
///         For BORROW, funds are sent to the executor so the next step can use them.
///
///         BORROW SIZING IS DONE ON-CHAIN. Backend passes a *target LTV*, and this adapter reads the user's real
///         collateral and the market's live oracle at execution time to compute the exact
///         borrow. This is immune to swap slippage (it sizes against collateral that
///         actually landed) and immune to decimal/price mistakes (price comes from the
///         same oracle Morpho uses for liquidation).
///
///         Production hardening:
///           - Pausable: owner can halt Morpho actions without touching the executor.
///           - ReentrancyGuard: defense in depth around the external Morpho/token calls.
///           - Oracle price and collateral are validated explicitly with clear reverts.
///           - A `minBorrow` floor avoids dust borrows on the tail of a leverage loop.
///           - BorrowExecuted event records the full sizing decision for indexers.
contract MorphoStrategyAdapter is
    IStrategyAdapter,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    /// @dev WAD = 1e18, the scale used for LTV and fractional values.
    uint256 internal constant WAD = 1e18;
    /// @dev Morpho oracle prices are scaled by 1e36.
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    /// @dev Morpho's virtual shares/assets used in share<->asset conversions.
    uint256 internal constant VIRTUAL_SHARES = 1e6;
    uint256 internal constant VIRTUAL_ASSETS = 1;

    IMorphoBlue public immutable morpho;
    address public executor;

    error UnsupportedAction();
    error OnlyExecutor();
    error ZeroExecutor();
    error InvalidTargetLtv();
    error OraclePriceZero();
    error NoCollateral();
    error NothingToBorrow();
    error BorrowBelowMinimum(uint256 computed, uint256 minBorrow);
    error BorrowExceedsCeiling(uint256 computed, uint256 ceiling);

    /// @notice Emitted on every successful borrow so the full sizing decision is indexable.
    /// @param user            the beneficiary whose Morpho position was acted on
    /// @param marketId        keccak256(abi.encode(MarketParams))
    /// @param collateral      collateral read from the position (collateral-token units)
    /// @param collateralValue collateral value in loan-token units (via oracle)
    /// @param targetLtvWad    requested LTV (1e18 scale)
    /// @param targetDebt      target debt implied by collateralValue * targetLtv
    /// @param currentDebt     debt before this borrow (loan-token units)
    /// @param borrowed        amount actually borrowed this step (loan-token units)
    event BorrowExecuted(
        address indexed user,
        bytes32 indexed marketId,
        uint256 collateral,
        uint256 collateralValue,
        uint256 targetLtvWad,
        uint256 targetDebt,
        uint256 currentDebt,
        uint256 borrowed
    );

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _morpho) {
        morpho = IMorphoBlue(_morpho);
        _disableInitializers();
    }

    function initialize(address _executor, address _owner) external initializer {
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Pausable_init();
        executor = _executor;
    }

    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroExecutor();
        executor = _executor;
    }

    // ══════════════════════════════════════════════════════════════
    //                          ADMIN
    // ══════════════════════════════════════════════════════════════

    /// @notice Halt all Morpho actions through this adapter (does not affect the executor).
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Execute a Morpho Blue action
    /// @dev data encoding per action:
    ///   SUPPLY_COLLATERAL:   abi.encode(MarketParams)
    ///   BORROW:              abi.encode(MarketParams, uint256 targetLtvWad, uint256 maxBorrow, uint256 minBorrow)
    ///   REPAY:               abi.encode(MarketParams)
    ///   WITHDRAW_COLLATERAL: abi.encode(MarketParams, uint256 withdrawAmount)
    function execute(ActionType action, address token, uint256 amount, address beneficiary, bytes calldata data)
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
        returns (address tokenOut, uint256 amountOut)
    {
        if (action == ActionType.SUPPLY_COLLATERAL) {
            return _supplyCollateral(token, amount, beneficiary, data);
        } else if (action == ActionType.BORROW) {
            return _borrow(beneficiary, data);
        } else if (action == ActionType.REPAY) {
            return _repay(token, amount, beneficiary, data);
        } else if (action == ActionType.WITHDRAW_COLLATERAL) {
            return _withdrawCollateral(beneficiary, data);
        }
        revert UnsupportedAction();
    }

    function _supplyCollateral(address token, uint256 amount, address beneficiary, bytes calldata data)
        internal
        returns (address, uint256)
    {
        IMorphoBlue.MarketParams memory params = abi.decode(data, (IMorphoBlue.MarketParams));

        IERC20(token).forceApprove(address(morpho), amount);
        morpho.supplyCollateral(params, amount, beneficiary, "");
        IERC20(token).forceApprove(address(morpho), 0);

        // No liquid output — collateral is in the user's Morpho position
        return (address(0), 0);
    }

    /// @notice Borrow to a target LTV, sized from the user's real collateral and the live oracle.
    /// @dev data = abi.encode(MarketParams params, uint256 targetLtvWad, uint256 maxBorrow, uint256 minBorrow)
    ///      - targetLtvWad: desired loan-to-value scaled by 1e18 (e.g. 80% = 0.8e18). Must be
    ///        strictly below the market LLTV; Morpho's own health check still guards the edge.
    ///      - maxBorrow: backend-supplied ceiling (loan-token units). Defense-in-depth cap so a
    ///        bad oracle read or stale state can never borrow more than the user was shown.
    ///      - minBorrow: floor (loan-token units). Below this the gap is treated as dust and the
    ///        step reverts, avoiding pointless micro-borrows on the tail of a leverage loop.
    function _borrow(address beneficiary, bytes calldata data) internal returns (address tokenOut, uint256 amountOut) {
        (IMorphoBlue.MarketParams memory params, uint256 targetLtvWad, uint256 maxBorrow, uint256 minBorrow) =
            abi.decode(data, (IMorphoBlue.MarketParams, uint256, uint256, uint256));

        // Target LTV must be sane and below the market liquidation LTV.
        if (targetLtvWad == 0 || targetLtvWad >= params.lltv) {
            revert InvalidTargetLtv();
        }

        bytes32 id = _marketId(params);

        // Accrue interest so the debt we read below is exact (not stale).
        morpho.accrueInterest(params);

        // Read the user's real position AFTER any prior supply step in this strategy.
        (, uint128 borrowShares, uint128 collateral) = morpho.position(id, beneficiary);

        // Fail loudly and specifically when there is no collateral to borrow against.
        if (collateral == 0) revert NoCollateral();

        // read price from oracle
        uint256 price = IOracle(params.oracle).price();
        if (price == 0) revert OraclePriceZero();

        uint256 collateralValue = Math.mulDiv(uint256(collateral), price, ORACLE_PRICE_SCALE);

        // Target debt for the requested LTV, in loan-token units.
        uint256 targetDebt = Math.mulDiv(collateralValue, targetLtvWad, WAD);

        // Current debt (loan-token units), rounded up against the borrower like Morpho does.
        uint256 currentDebt = _currentDebtAssets(id, borrowShares);

        // Only borrow the gap up to the target. If already at/above target, there is
        // nothing to do and we must not borrow (which would push LTV past target).
        if (targetDebt <= currentDebt) revert NothingToBorrow();
        uint256 borrowAmount = targetDebt - currentDebt;

        // Dust guard
        if (borrowAmount < minBorrow) {
            revert BorrowBelowMinimum(borrowAmount, minBorrow);
        }

        // Defense in depth: never exceed the ceiling the user was shown off-chain.
        if (borrowAmount > maxBorrow) {
            revert BorrowExceedsCeiling(borrowAmount, maxBorrow);
        }

        // Borrow on behalf of the user, receive funds HERE, then forward to the executor
        // so the next step (a swap) can consume them.
        (uint256 borrowed,) = morpho.borrow(params, borrowAmount, 0, beneficiary, address(this));

        IERC20(params.loanToken).safeTransfer(executor, borrowed);

        emit BorrowExecuted(
            beneficiary, id, uint256(collateral), collateralValue, targetLtvWad, targetDebt, currentDebt, borrowed
        );

        return (params.loanToken, borrowed);
    }

    function _repay(address token, uint256 amount, address beneficiary, bytes calldata data)
        internal
        returns (address, uint256)
    {
        IMorphoBlue.MarketParams memory params = abi.decode(data, (IMorphoBlue.MarketParams));

        IERC20(token).forceApprove(address(morpho), amount);
        (uint256 repaid,) = morpho.repay(params, amount, 0, beneficiary, "");
        IERC20(token).forceApprove(address(morpho), 0);

        // If Morpho consumed less than `amount` (repay capped at actual debt),
        // return excess to executor so the sweep loop catches it.
        uint256 excess = amount - repaid;
        if (excess > 0) {
            IERC20(token).safeTransfer(executor, excess);
            return (token, excess);
        }
        return (address(0), 0);
    }

    function _withdrawCollateral(address beneficiary, bytes calldata data)
        internal
        returns (address tokenOut, uint256 amountOut)
    {
        (IMorphoBlue.MarketParams memory params, uint256 withdrawAmount) =
            abi.decode(data, (IMorphoBlue.MarketParams, uint256));

        // Withdraw to executor so next step can use it
        morpho.withdrawCollateral(params, withdrawAmount, beneficiary, executor);

        return (params.collateralToken, withdrawAmount);
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Internal math
    // ──────────────────────────────────────────────────────────────────────

    /// @dev Morpho market id = keccak256(abi.encode(MarketParams)).
    function _marketId(IMorphoBlue.MarketParams memory params) internal pure returns (bytes32) {
        return keccak256(abi.encode(params));
    }

    /// @dev Convert borrow shares into loan-token assets, rounding UP against the
    ///      borrower exactly as Morpho does (so we never under-count existing debt).
    function _currentDebtAssets(bytes32 id, uint128 borrowShares) internal view returns (uint256) {
        if (borrowShares == 0) return 0;
        (,, uint128 totalBorrowAssets, uint128 totalBorrowShares,,) = morpho.market(id);
        return Math.mulDiv(
            uint256(borrowShares),
            uint256(totalBorrowAssets) + VIRTUAL_ASSETS,
            uint256(totalBorrowShares) + VIRTUAL_SHARES,
            Math.Rounding.Ceil
        );
    }

    /// @notice Rescue tokens accidentally sent to adapter
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
