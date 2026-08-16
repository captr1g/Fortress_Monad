// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Swap target callable by SwapStrategyAdapter via dex.call(swapCalldata).
///         The adapter forceApproves this contract for tokenIn, then this contract
///         pulls tokenIn from the caller (the adapter) and sends tokenOut to recipient.
///         Must be pre-funded with tokenOut.
contract MockDex {
    /// @notice Deterministic swap: pull amountIn of tokenIn from caller, send amountOut of tokenOut.
    function swapExact(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut,
        address recipient
    ) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
    }

    /// @notice Always reverts — used to exercise the SwapFailed path.
    function swapRevert() external pure {
        revert("MockDex: forced revert");
    }
}
