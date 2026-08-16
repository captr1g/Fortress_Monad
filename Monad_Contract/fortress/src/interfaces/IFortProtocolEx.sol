// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IFortProtocol.sol";

/// @title IFortProtocolEx — extended adapter interface supporting arbitrary calldata
/// @notice For protocols (e.g. LiFi) that need routing/swap data beyond amount+receiver.
interface IFortProtocolEx is IFortProtocol {
    /// @notice Deposit USDC with additional protocol-specific data
    /// @param usdcAmount Amount of USDC to deposit
    /// @param receiver Address that receives protocol tokens
    /// @param data Protocol-specific calldata (e.g. swap routes, bridge params)
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data) external;

    /// @notice Redeem shares with additional protocol-specific data
    /// @param shares Amount of protocol shares/tokens to redeem
    /// @param receiver Address that receives USDC
    /// @param owner Address that owns the shares being redeemed
    /// @param data Protocol-specific calldata
    /// @return usdcOut Amount of USDC sent to receiver
    function redeemFor(uint256 shares, address receiver, address owner, bytes calldata data)
        external
        returns (uint256 usdcOut);
}
