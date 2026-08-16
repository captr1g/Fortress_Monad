// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IMorphoBlue.sol";

/// @notice In-memory Morpho Blue mock for tests.
///         Positions keyed by id = keccak256(abi.encode(marketParams)).
///         borrowShares track assets 1:1 for simplicity. The mock holds a
///         pre-funded reserve of loanToken which it transfers out on borrow.
contract MockMorphoBlue is IMorphoBlue {
    struct Position {
        uint256 supplyShares;
        uint128 borrowShares;
        uint128 collateral;
    }

    // id => user => position
    mapping(bytes32 => mapping(address => Position)) internal _positions;

    // id => aggregate borrow totals. borrowShares track assets 1:1, so totals
    // mirror the sum of borrowed assets. This makes the adapter's share->asset
    // conversion an identity in tests (matching the 1:1 simplification here).
    mapping(bytes32 => uint128) internal _totalBorrowAssets;
    mapping(bytes32 => uint128) internal _totalBorrowShares;

    // authorizer => authorized => bool
    mapping(address => mapping(address => bool)) internal _authorized;

    function _id(MarketParams memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(p));
    }

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes calldata
    ) external override {
        IERC20(marketParams.collateralToken).transferFrom(
            msg.sender,
            address(this),
            assets
        );
        _positions[_id(marketParams)][onBehalf].collateral += uint128(assets);
    }

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 /* shares */,
        address onBehalf,
        address receiver
    )
        external
        override
        returns (uint256 assetsBorrowed, uint256 sharesBorrowed)
    {
        bytes32 id = _id(marketParams);
        _positions[id][onBehalf].borrowShares += uint128(assets);
        _totalBorrowAssets[id] += uint128(assets);
        _totalBorrowShares[id] += uint128(assets);
        IERC20(marketParams.loanToken).transfer(receiver, assets);
        return (assets, assets);
    }

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata
    ) external override returns (uint256 assetsRepaid, uint256 sharesRepaid) {
        bytes32 id = _id(marketParams);
        uint128 repayShares;
        uint128 repayAssets;
        if (shares > 0) {
            repayShares = uint128(shares);
            repayAssets = uint128(_sharesToAssets(id, uint128(shares)));
        } else {
            // Cap at actual debt — real Morpho only repays min(assets, debt)
            uint128 currentBorrow = _positions[id][onBehalf].borrowShares;
            repayAssets = assets > uint256(currentBorrow) ? currentBorrow : uint128(assets);
            repayShares = repayAssets;
        }
        IERC20(marketParams.loanToken).transferFrom(
            msg.sender,
            address(this),
            repayAssets
        );
        _positions[id][onBehalf].borrowShares -= repayShares;
        _totalBorrowAssets[id] -= repayAssets;
        _totalBorrowShares[id] -= repayShares;
        return (repayAssets, repayShares);
    }

    /// @notice Minimal Morpho flash loan: send tokens, invoke the callback, pull them back.
    function flashLoan(
        address token,
        uint256 assets,
        bytes calldata data
    ) external override {
        IERC20(token).transfer(msg.sender, assets);
        IMorphoFlashLoanCallback(msg.sender).onMorphoFlashLoan(assets, data);
        IERC20(token).transferFrom(msg.sender, address(this), assets);
    }

    function _sharesToAssets(
        bytes32 id,
        uint128 shares
    ) internal view returns (uint256) {
        uint256 totalAssets = uint256(_totalBorrowAssets[id]) + 1e24 + 1;
        uint256 totalShares = uint256(_totalBorrowShares[id]) + 1e24 + 1e6;
        return (uint256(shares) * totalAssets + totalShares - 1) / totalShares;
    }

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external override {
        _positions[_id(marketParams)][onBehalf].collateral -= uint128(assets);
        IERC20(marketParams.collateralToken).transfer(receiver, assets);
    }

    function setAuthorization(
        address authorized,
        bool newIsAuthorized
    ) external override {
        _authorized[msg.sender][authorized] = newIsAuthorized;
    }

    function isAuthorized(
        address authorizer,
        address authorized
    ) external view override returns (bool) {
        return _authorized[authorizer][authorized];
    }

    // ──── Test helpers / getters ────

    function position(
        bytes32 id,
        address user
    )
        external
        view
        override
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)
    {
        Position storage p = _positions[id][user];
        return (p.supplyShares, p.borrowShares, p.collateral);
    }

    function market(
        bytes32 id
    )
        external
        view
        override
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        )
    {
        // Simulate a large, established market so Morpho's virtual-shares rounding
        // (+1 asset / +1e6 shares) is negligible — matching mainnet where totals
        // dwarf the virtual offsets. The baseline must be large relative to 1e6 so
        // share->asset conversion is exact to the wei for realistic debt sizes.
        uint128 baseline = 1e24;
        return (
            0,
            0,
            _totalBorrowAssets[id] + baseline,
            _totalBorrowShares[id] + baseline,
            0,
            0
        );
    }

    /// @notice No-op in the mock: borrowShares already track assets 1:1, so there
    ///         is no interest to accrue. Present to satisfy the interface and to
    ///         exercise the adapter's accrual call path.
    function accrueInterest(MarketParams memory) external override {}

    function positionFor(
        MarketParams memory marketParams,
        address user
    )
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)
    {
        Position storage p = _positions[_id(marketParams)][user];
        return (p.supplyShares, p.borrowShares, p.collateral);
    }

    /// @notice Fund the mock with a loanToken reserve so it can serve borrows.
    function fundReserve(address token, uint256 amount) external {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
    }
}
