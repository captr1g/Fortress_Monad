// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock Compound V3 Comet for unit testing.
///         Tracks balances 1:1 with USDC supplied. No actual rebasing.
contract MockComet {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => bool)) public allowances;

    // Call recording
    uint256 public supplyCallCount;
    uint256 public withdrawCallCount;
    address public lastDst;
    uint256 public lastAmount;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function supply(address asset, uint256 amount) external {
        require(asset == address(usdc), "wrong asset");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        supplyCallCount++;
        lastAmount = amount;
    }

    function supplyTo(address dst, address asset, uint256 amount) external {
        require(asset == address(usdc), "wrong asset");
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        balances[dst] += amount;
        supplyCallCount++;
        lastDst = dst;
        lastAmount = amount;
    }

    function withdraw(address asset, uint256 amount) external {
        require(asset == address(usdc), "wrong asset");
        balances[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        withdrawCallCount++;
        lastAmount = amount;
    }

    function withdrawTo(address to, address asset, uint256 amount) external {
        require(asset == address(usdc), "wrong asset");
        balances[msg.sender] -= amount;
        usdc.safeTransfer(to, amount);
        withdrawCallCount++;
        lastAmount = amount;
    }

    function withdrawFrom(address src, address to, address asset, uint256 amount) external {
        require(asset == address(usdc), "wrong asset");
        require(msg.sender == src || allowances[src][msg.sender], "not allowed");
        balances[src] -= amount;
        usdc.safeTransfer(to, amount);
        withdrawCallCount++;
        lastDst = to;
        lastAmount = amount;
    }

    function allow(address manager, bool isAllowed) external {
        allowances[msg.sender][manager] = isAllowed;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address dst, uint256 amount) external returns (bool) {
        balances[msg.sender] -= amount;
        balances[dst] += amount;
        return true;
    }

    function transferFrom(address src, address dst, uint256 amount) external returns (bool) {
        require(msg.sender == src || allowances[src][msg.sender], "not allowed");
        balances[src] -= amount;
        balances[dst] += amount;
        return true;
    }
}
