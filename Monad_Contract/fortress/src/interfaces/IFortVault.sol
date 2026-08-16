// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IFortVault — minimal interface for FortSwapRouter to read vault state
interface IFortVault {
    function protocols(bytes32 key) external view returns (address addr, bool isERC4626);
    function depositFeeBps() external view returns (uint16);
    function feeRecipient() external view returns (address);
    function owner() external view returns (address);
}
