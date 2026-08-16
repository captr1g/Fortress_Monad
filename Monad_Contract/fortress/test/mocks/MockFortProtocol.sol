// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IFortProtocol.sol";

contract MockFortProtocol is IFortProtocol {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    mapping(address => uint256) public shares;

    // Call recording for test assertions
    uint256 public depositCallCount;
    uint256 public redeemCallCount;
    address public lastReceiver;
    uint256 public lastAmount;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function depositFor(uint256 usdcAmount, address receiver) external override {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        shares[receiver] += usdcAmount; // 1:1 ratio
        depositCallCount++;
        lastReceiver = receiver;
        lastAmount = usdcAmount;
    }

    function redeemFor(uint256 _shares, address receiver, address owner) external override returns (uint256) {
        shares[owner] -= _shares;
        usdc.safeTransfer(receiver, _shares); // 1:1 ratio
        redeemCallCount++;
        lastReceiver = receiver;
        lastAmount = _shares;
        return _shares;
    }
}
