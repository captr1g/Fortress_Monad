// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../../src/config/MonadAddresses.sol";

/// @notice FastLane shMONAD mock — an ERC-4626 whose asset is native MON.
///
/// @dev Reproduces the three behaviours that make shMONAD awkward, all confirmed
///      against the live contract at the pinned block:
///
///        1. `asset()` is the `0xEeee…` sentinel, not an ERC-20.
///        2. `deposit` is **payable** and reverts without value. The live contract
///           reverts `0x309a6b54`; this one reverts `MissingValue`.
///        3. `redeem` applies a real exit haircut — 0.645% live — so
///           `previewRedeem` sits below `convertToAssets`. A mock without it would
///           make the adapter's separate `minMonOut` floor look redundant.
contract MockShMonad {
    string public name = "Mock ShMonad";
    string public symbol = "shMON";
    uint8 public decimals = 18;

    /// @notice shMON minted per 1e18 MON supplied.
    uint256 public shareRate;

    /// @notice Exit haircut in basis points. 65 == 0.65%, close to the live value.
    uint256 public exitHaircutBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    uint256 public maxDepositAmount = type(uint128).max;

    error MissingValue();
    error ValueMismatch();
    error InsufficientBalance();
    error InsufficientAllowance();
    error NativeSendFailed();

    constructor(uint256 _shareRate, uint256 _exitHaircutBps) {
        shareRate = _shareRate;
        exitHaircutBps = _exitHaircutBps;
    }

    receive() external payable {}

    function setShareRate(uint256 r) external {
        shareRate = r;
    }

    function setExitHaircutBps(uint256 b) external {
        exitHaircutBps = b;
    }

    function setMaxDeposit(uint256 m) external {
        maxDepositAmount = m;
    }

    function asset() external pure returns (address) {
        return MonadAddresses.NATIVE;
    }

    function maxDeposit(address) external view returns (uint256) {
        return maxDepositAmount;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return (assets * shareRate) / 1e18;
    }

    /// @dev Raw exchange rate, haircut EXCLUDED — the number a caller must not size
    ///      a minimum against.
    function convertToAssets(uint256 shares) public view returns (uint256) {
        return (shares * 1e18) / shareRate;
    }

    /// @dev What a redemption actually pays, haircut INCLUDED.
    function previewRedeem(uint256 shares) public view returns (uint256) {
        return (convertToAssets(shares) * (10_000 - exitHaircutBps)) / 10_000;
    }

    function deposit(uint256 assets, address receiver) external payable returns (uint256 shares) {
        if (msg.value == 0) revert MissingValue();
        if (msg.value != assets) revert ValueMismatch();

        shares = convertToShares(assets);
        balanceOf[receiver] += shares;
        totalSupply += shares;
    }

    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets) {
        if (owner != msg.sender) {
            uint256 allowed = allowance[owner][msg.sender];
            if (allowed != type(uint256).max) {
                if (allowed < shares) revert InsufficientAllowance();
                allowance[owner][msg.sender] = allowed - shares;
            }
        }
        if (balanceOf[owner] < shares) revert InsufficientBalance();

        balanceOf[owner] -= shares;
        totalSupply -= shares;

        assets = previewRedeem(shares);
        (bool ok,) = payable(receiver).call{value: assets}("");
        if (!ok) revert NativeSendFailed();
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert InsufficientBalance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
