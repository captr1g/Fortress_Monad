// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IAerodromeGauge.sol";

/// @title MockAerodromeGauge — simulates Aerodrome Gauge for testing
/// @notice ERC20 receipt token. Deposits stake token, withdraws stake token, getReward.
contract MockAerodromeGauge is ERC20, IAerodromeGauge {
    address public override stakingToken;
    address public override rewardToken;

    uint256 public depositCallCount;
    uint256 public withdrawCallCount;
    uint256 public getRewardCallCount;

    /// @notice Configurable reward amount per getReward call
    uint256 public rewardAmount;

    constructor(
        address _stakingToken,
        address _rewardToken
    ) ERC20("Gauge Receipt", "gLP") {
        stakingToken = _stakingToken;
        rewardToken = _rewardToken;
    }

    function setRewardAmount(uint256 _amount) external {
        rewardAmount = _amount;
    }

    function deposit(uint256 amount) external override {
        depositCallCount++;
        IERC20(stakingToken).transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, amount);
    }

    function deposit(uint256 amount, address recipient) external override {
        depositCallCount++;
        IERC20(stakingToken).transferFrom(msg.sender, address(this), amount);
        _mint(recipient, amount);
    }

    function withdraw(uint256 amount) external override {
        withdrawCallCount++;
        _burn(msg.sender, amount);
        IERC20(stakingToken).transfer(msg.sender, amount);
    }

    function getReward(address account) external override {
        getRewardCallCount++;
        if (rewardAmount > 0) {
            // Mint reward tokens to account (requires MockUSDC-style mintable token)
            MockRewardMintable(rewardToken).mint(account, rewardAmount);
        }
    }

    function earned(address) external view override returns (uint256) {
        return rewardAmount;
    }

    function balanceOf(address account) public view override(ERC20, IAerodromeGauge) returns (uint256) {
        return super.balanceOf(account);
    }
}

interface MockRewardMintable {
    function mint(address to, uint256 amount) external;
}
