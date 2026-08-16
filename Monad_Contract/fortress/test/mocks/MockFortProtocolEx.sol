// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IFortProtocolEx.sol";

contract MockFortProtocolEx is IFortProtocolEx {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    mapping(address => uint256) public shares;

    uint256 public depositCallCount;
    uint256 public redeemCallCount;
    uint256 public depositExCallCount;
    uint256 public redeemExCallCount;
    address public lastReceiver;
    uint256 public lastAmount;
    bytes public lastData;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    // IFortProtocol base
    function depositFor(uint256 usdcAmount, address receiver) external override {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        shares[receiver] += usdcAmount;
        depositCallCount++;
        lastReceiver = receiver;
        lastAmount = usdcAmount;
    }

    function redeemFor(uint256 _shares, address receiver, address owner) external override returns (uint256) {
        shares[owner] -= _shares;
        usdc.safeTransfer(receiver, _shares);
        redeemCallCount++;
        lastReceiver = receiver;
        lastAmount = _shares;
        return _shares;
    }

    // IFortProtocolEx extended
    function depositFor(uint256 usdcAmount, address receiver, bytes calldata data) external override {
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);
        shares[receiver] += usdcAmount;
        depositExCallCount++;
        lastReceiver = receiver;
        lastAmount = usdcAmount;
        lastData = data;
    }

    function redeemFor(uint256 _shares, address receiver, address owner, bytes calldata data) external override returns (uint256) {
        shares[owner] -= _shares;
        usdc.safeTransfer(receiver, _shares);
        redeemExCallCount++;
        lastReceiver = receiver;
        lastAmount = _shares;
        lastData = data;
        return _shares;
    }
}
