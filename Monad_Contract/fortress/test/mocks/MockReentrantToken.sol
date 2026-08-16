// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IReentryHook {
    function reenter() external;
}

/// @notice ERC20 that, on its FIRST transfer/transferFrom, calls back into a
///         configured hook exactly once. Used to prove ReentrancyGuard blocks a
///         re-entrant call routed through a token-transfer callback.
contract MockReentrantToken is ERC20 {
    uint8 private immutable _decimals;
    address public hook;
    bool private _entered;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address hook_) external {
        hook = hook_;
    }

    function _fireHook() internal {
        if (hook != address(0) && !_entered) {
            _entered = true;
            IReentryHook(hook).reenter();
        }
    }

    function transfer(
        address to,
        uint256 value
    ) public override returns (bool) {
        _fireHook();
        return super.transfer(to, value);
    }

    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override returns (bool) {
        _fireHook();
        return super.transferFrom(from, to, value);
    }
}
