// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../src/interfaces/IOracle.sol";

/// @notice Mock Morpho oracle. Returns a settable price for 1 collateral unit in
///         loan-token units, scaled by 1e36 (Morpho's ORACLE_PRICE_SCALE).
///
///         The price must encode the decimal difference between collateral and loan
///         tokens, e.g. for an 18-dec collateral worth $1 and a 6-dec loan token worth $1:
///             price = 1e36 * 10^(loanDecimals) / 10^(collateralDecimals)
///                   = 1e36 * 1e6 / 1e18 = 1e24
contract MockOracle is IOracle {
    uint256 public price;

    constructor(uint256 _price) {
        price = _price;
    }

    function setPrice(uint256 _price) external {
        price = _price;
    }
}
