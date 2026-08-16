// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC4626Vault is ERC4626 {
    constructor(IERC20 asset_)
        ERC4626(asset_)
        ERC20("Mock Vault", "mVault")
    {}
}
