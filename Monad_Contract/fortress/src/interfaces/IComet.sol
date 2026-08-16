// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IComet — Compound V3 Comet interface (subset)
/// @notice Rebasing-balance model: no share token, balance auto-increases with interest.
interface IComet {
    function supply(address asset, uint256 amount) external;
    function supplyTo(address dst, address asset, uint256 amount) external;
    function withdraw(address asset, uint256 amount) external;
    function withdrawTo(address to, address asset, uint256 amount) external;
    function withdrawFrom(address src, address to, address asset, uint256 amount) external;
    function allow(address manager, bool isAllowed) external;
    function balanceOf(address account) external view returns (uint256);
    function transfer(address dst, uint256 amount) external returns (bool);
    function transferFrom(address src, address dst, uint256 amount) external returns (bool);
}
