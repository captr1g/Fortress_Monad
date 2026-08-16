// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockYoVault — ERC4626 mock with configurable maxRedeem
contract MockYoVault is ERC4626 {
    uint256 private _maxRedeemOverride;
    bool private _useMaxRedeemOverride;

    uint256 public depositCallCount;
    uint256 public redeemCallCount;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("yoUSD", "yoUSD") {}

    /// @notice Set a custom maxRedeem value (simulates async redemption limits)
    function setMaxRedeem(uint256 maxRedeem_) external {
        _maxRedeemOverride = maxRedeem_;
        _useMaxRedeemOverride = true;
    }

    /// @notice Clear maxRedeem override (use default ERC4626 behavior)
    function clearMaxRedeemOverride() external {
        _useMaxRedeemOverride = false;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (_useMaxRedeemOverride) {
            uint256 bal = balanceOf(owner);
            return _maxRedeemOverride < bal ? _maxRedeemOverride : bal;
        }
        return super.maxRedeem(owner);
    }

    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        depositCallCount++;
        return super.deposit(assets, receiver);
    }

    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        redeemCallCount++;
        return super.redeem(shares, receiver, owner);
    }
}
