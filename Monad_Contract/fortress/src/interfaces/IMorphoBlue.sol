// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMorphoBlue — minimal interface for Morpho Blue interactions
interface IMorphoBlue {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function supplyCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes calldata data
    ) external;

    function borrow(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);

    function repay(
        MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        bytes calldata data
    ) external returns (uint256 assetsRepaid, uint256 sharesRepaid);

    function withdrawCollateral(
        MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        address receiver
    ) external;

    function setAuthorization(
        address authorized,
        bool newIsAuthorized
    ) external;

    function isAuthorized(
        address authorizer,
        address authorized
    ) external view returns (bool);

    // ──────────────────────────────────────────────────────────────────────
    //  Reads needed for on-chain, oracle-based borrow sizing
    // ──────────────────────────────────────────────────────────────────────

    /// @notice A user's position in a market, keyed by the market id.
    /// @param id keccak256(abi.encode(MarketParams))
    /// @return supplyShares supply-side shares
    /// @return borrowShares borrow-side shares (convert to assets via market totals)
    /// @return collateral collateral amount in collateral-token units
    function position(
        bytes32 id,
        address user
    )
        external
        view
        returns (
            uint256 supplyShares,
            uint128 borrowShares,
            uint128 collateral
        );

    /// @notice Aggregate market state, used to convert borrow shares into assets.
    /// @return totalSupplyAssets total supplied assets
    /// @return totalSupplyShares total supply shares
    /// @return totalBorrowAssets total borrowed assets
    /// @return totalBorrowShares total borrow shares
    /// @return lastUpdate last interest accrual timestamp
    /// @return fee market fee (scaled by 1e18)
    function market(
        bytes32 id
    )
        external
        view
        returns (
            uint128 totalSupplyAssets,
            uint128 totalSupplyShares,
            uint128 totalBorrowAssets,
            uint128 totalBorrowShares,
            uint128 lastUpdate,
            uint128 fee
        );

    /// @notice Force interest accrual so debt reads are exact at execution time.
    function accrueInterest(MarketParams memory marketParams) external;

    /// @notice Free flash loan of `assets` of `token`. Morpho sends the tokens, calls
    ///         `onMorphoFlashLoan(assets, data)` on msg.sender, then pulls `assets` back
    ///         via transferFrom (caller must approve). No fee on Morpho Blue.
    function flashLoan(
        address token,
        uint256 assets,
        bytes calldata data
    ) external;
}

/// @title IMorphoFlashLoanCallback — callback invoked by Morpho during a flash loan.
interface IMorphoFlashLoanCallback {
    function onMorphoFlashLoan(uint256 assets, bytes calldata data) external;
}
