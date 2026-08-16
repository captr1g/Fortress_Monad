// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/ILiFi.sol";

/// @notice Mock LiFi Diamond for testing. Simulates swaps at a configurable rate.
contract MockLiFiDiamond {
    using SafeERC20 for IERC20;

    // rate = outputAmount * 1e6 / inputAmount
    uint256 public rate; // e.g. 1e6 = 1:1, 2e6 = 2:1

    // Call recording
    uint256 public swapCallCount;
    bytes32 public lastTransactionId;
    address public lastReceiver;
    uint256 public lastMinAmount;

    constructor(uint256 _rate) {
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function swapTokensGeneric(
        bytes32 _transactionId,
        string calldata,
        string calldata,
        address payable _receiver,
        uint256 _minAmount,
        LibSwap.SwapData[] calldata _swapData
    ) external payable {
        require(_swapData.length > 0, "no swap data");

        LibSwap.SwapData calldata swap = _swapData[0];

        // Pull input token from caller
        IERC20(swap.sendingAssetId).safeTransferFrom(msg.sender, address(this), swap.fromAmount);

        // Calculate output
        uint256 outputAmount = (swap.fromAmount * rate) / 1e6;
        require(outputAmount >= _minAmount, "slippage");

        // Transfer output token to receiver
        IERC20(swap.receivingAssetId).safeTransfer(_receiver, outputAmount);

        swapCallCount++;
        lastTransactionId = _transactionId;
        lastReceiver = _receiver;
        lastMinAmount = _minAmount;
    }
}
