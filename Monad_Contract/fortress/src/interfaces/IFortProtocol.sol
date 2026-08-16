// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFortProtocol — adapter interface for non-ERC-4626 protocols
/// @notice Stateless pass-through: translates calls to protocol's native interface,
///         ensures all output tokens (shares, LP, NFTs) go directly to receiver.
interface IFortProtocol {
    /// @notice Deposit USDC, send all resulting tokens to receiver
    /// @param usdcAmount Amount of USDC to deposit
    /// @param receiver Address that receives protocol tokens
    function depositFor(uint256 usdcAmount, address receiver) external;

    /// @notice Redeem shares/tokens from owner, send USDC to receiver
    /// @param shares Amount of protocol shares/tokens to redeem
    /// @param receiver Address that receives USDC
    /// @param owner Address that owns the shares being redeemed
    /// @return usdcOut Amount of USDC sent to receiver
    function redeemFor(uint256 shares, address receiver, address owner) external returns (uint256 usdcOut);
}
