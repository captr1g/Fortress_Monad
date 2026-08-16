// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC4626Vault is ERC4626 {
    /// @dev Deposit cap, mirroring MetaMorpho V2's behaviour on Monad where every
    ///      sizeable USDC vault currently reports maxDeposit() == 0 because it is at
    ///      cap. Defaults to uncapped so existing tests are unaffected.
    uint256 private _maxDepositOverride = type(uint256).max;
    bool private _capSet;

    constructor(IERC20 asset_) ERC4626(asset_) ERC20("Mock Vault", "mVault") {}

    /// @notice Test hook: pin maxDeposit() to a fixed value (0 simulates "at cap").
    function setMaxDeposit(uint256 cap) external {
        _maxDepositOverride = cap;
        _capSet = true;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (_capSet) return _maxDepositOverride;
        return super.maxDeposit(receiver);
    }

    /// @dev EIP-4626 requires deposit() to revert when it exceeds maxDeposit().
    ///      Enforced here so the mock behaves like a real capped vault.
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        require(assets <= maxDeposit(receiver), "MockERC4626Vault: exceeds max deposit");
        return super.deposit(assets, receiver);
    }
}
