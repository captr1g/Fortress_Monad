// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Rate-based swap mock. Pulls `amountIn` of tokenIn from the caller and delivers
///         `amountIn * rate / 1e18` of tokenOut to `recipient`. Models a real aggregator that
///         consumes the exact input at a given price, letting fuzz tests vary both the input
///         size and the price freely. Must be pre-funded with tokenOut.
contract MockRateDex {
    /// @param rate tokenOut delivered per unit tokenIn, scaled by 1e18. Any collateral/loan
    ///             decimal difference is folded into `rate` by the test.
    function swapAtRate(address tokenIn, uint256 amountIn, address tokenOut, uint256 rate, address recipient)
        external
        returns (uint256 amountOut)
    {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        amountOut = (amountIn * rate) / 1e18;
        IERC20(tokenOut).transfer(recipient, amountOut);
    }
}
