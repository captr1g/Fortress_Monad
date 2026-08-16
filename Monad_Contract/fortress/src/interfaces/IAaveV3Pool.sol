// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IAaveV3Pool — the slice of the Aave V3 Pool FORTRESS actually calls
///
/// @notice Deliberately minimal. Monad hosts two Aave V3 markets at **different
///         revisions** — `Aave V3 Monad` reports `POOL_REVISION() == 11`, the
///         `Neverland Market V3` fork reports `2` — and the Pool ABI is not stable
///         across that gap. Only functions verified to behave identically on both
///         are declared here.
///
/// @dev What was checked, live on chain 143:
///
///        - `supply` / `withdraw` — unchanged since v3.0, present on both.
///        - `getConfiguration(address)` — present on both, and the bit positions
///          this codebase reads (active, frozen, paused, supply cap) decode to the
///          same fields on both. Verified by decoding each market's raw bitmap and
///          cross-checking every field against that market's own
///          `PoolDataProvider.getReserveConfigurationData` / `getReserveCaps`.
///
///      What is deliberately NOT declared, and why:
///
///        - `getReserveData(address)` returns a `DataTypes.ReserveData` struct whose
///          layout DID change across these revisions — v3.2 removed stable-rate
///          borrowing, and the two markets disagree accordingly (`Aave V3 Monad`
///          returns `address(0)` for the stable debt token; Neverland returns a real
///          one). Decoding it against a single struct definition would silently
///          misread one of the two markets. The configuration bitmap carries
///          everything FORTRESS needs, in one word, with a layout that did not move.
///        - `getPoolDataProvider()` results are not cached: in Aave V3 the data
///          provider is a plain contract that gets REPLACED on upgrade, unlike the
///          Pool and aToken, which are proxies at stable addresses.
interface IAaveV3Pool {
    /// @notice Supplies `amount` of `asset`, crediting aTokens to `onBehalfOf`.
    /// @dev Lets FORTRESS satisfy I2 without a round-trip: the receiver is credited
    ///      by the pool directly, so the adapter never holds the position.
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    /// @notice Burns the caller's aTokens and sends `asset` to `to`.
    /// @param amount Pass `type(uint256).max` to withdraw the full balance.
    /// @return The amount actually withdrawn.
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);

    /// @notice The reserve's liquidity index, in ray, accrued to now.
    /// @dev Present and unchanged on both Monad markets. Used to size the rounding
    ///      tolerance on a scaled-balance round trip, which grows with the index.
    function getReserveNormalizedIncome(address asset) external view returns (uint256);

    /// @notice The reserve's packed configuration bitmap.
    /// @dev Declared as a bare `uint256`. Aave returns
    ///      `DataTypes.ReserveConfigurationMap`, a struct wrapping one `uint256`,
    ///      which ABI-encodes identically; the selector depends only on the argument
    ///      types, so this decodes correctly against the real Pool.
    function getConfiguration(address asset) external view returns (uint256);
}

/// @title IAToken — the aToken surface FORTRESS needs beyond plain ERC-20
/// @dev Both accessors exist on the aTokens of both Monad markets and are used to
///      prove, at construction, that an adapter instance was wired to a matching
///      (pool, aToken, underlying) triple.
interface IAToken is IERC20 {
    function POOL() external view returns (address);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

/// @title IPoolAddressesProvider — Aave's root of trust for a market
/// @dev Not used on the hot path. `getPool()` returns a proxy whose ADDRESS never
///      changes, so the adapter caches it as an immutable rather than resolving it
///      per call — a resolve would cost a cold SLOAD plus an external call, and on
///      Monad a cold SLOAD is ~8,100 gas.
interface IPoolAddressesProvider {
    function getPool() external view returns (address);
    function getPoolDataProvider() external view returns (address);
    function getMarketId() external view returns (string memory);
}

/// @title LibAaveReserve — reads the fields FORTRESS needs out of the config bitmap
///
/// @dev Bit layout, unchanged from Aave v3.0 through v3.4 and verified against both
///      Monad markets:
///
///        bits  48-55   decimals
///        bit   56      reserve is active
///        bit   57      reserve is frozen
///        bit   58      borrowing enabled
///        bit   60      reserve is paused
///        bits  64-79   reserve factor
///        bits  80-115  borrow cap        (whole tokens)
///        bits  116-151 supply cap        (whole tokens)
///
///      Caps are stored in WHOLE TOKENS, not in the asset's smallest unit — Aave
///      scales by `10 ** decimals` at the point of comparison, and so does this
///      library. `0` means uncapped.
library LibAaveReserve {
    uint256 internal constant DECIMALS_SHIFT = 48;
    uint256 internal constant ACTIVE_BIT = 56;
    uint256 internal constant FROZEN_BIT = 57;
    uint256 internal constant PAUSED_BIT = 60;
    uint256 internal constant SUPPLY_CAP_SHIFT = 116;

    uint256 internal constant CAP_MASK = 0xFFFFFFFFF; // 36 bits
    uint256 internal constant DECIMALS_MASK = 0xFF;

    function isActive(uint256 config) internal pure returns (bool) {
        return (config >> ACTIVE_BIT) & 1 != 0;
    }

    function isFrozen(uint256 config) internal pure returns (bool) {
        return (config >> FROZEN_BIT) & 1 != 0;
    }

    function isPaused(uint256 config) internal pure returns (bool) {
        return (config >> PAUSED_BIT) & 1 != 0;
    }

    function decimals(uint256 config) internal pure returns (uint256) {
        return (config >> DECIMALS_SHIFT) & DECIMALS_MASK;
    }

    /// @return Supply cap in WHOLE tokens. `0` means uncapped.
    function supplyCap(uint256 config) internal pure returns (uint256) {
        return (config >> SUPPLY_CAP_SHIFT) & CAP_MASK;
    }
}
