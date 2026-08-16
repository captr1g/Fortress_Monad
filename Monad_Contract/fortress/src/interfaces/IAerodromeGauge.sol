// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IAerodromeGauge — minimal interface for Aerodrome V2 Gauge
interface IAerodromeGauge {
    function deposit(uint256 amount) external;
    function deposit(uint256 amount, address recipient) external;
    function withdraw(uint256 amount) external;
    function getReward(address account) external;
    function balanceOf(address account) external view returns (uint256);
    function earned(address account) external view returns (uint256);
    function stakingToken() external view returns (address);
    function rewardToken() external view returns (address);
}
