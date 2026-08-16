// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IOracle — Morpho Blue oracle interface
/// @notice Morpho markets price collateral in loan-token terms through this oracle.
///         `price()` returns the price of 1 unit of collateral, denominated in the
///         loan token, scaled by 1e36. The scaling already accounts for the decimal
///         difference between the collateral and loan tokens, so consumers never need
///         to do decimal conversion themselves:
///
///             collateralValueInLoan = collateralAmount * price() / 1e36
///
interface IOracle {
    /// @notice Price of 1 collateral unit in loan-token units, scaled by 1e36.
    function price() external view returns (uint256);
}
