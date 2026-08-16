// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IStrategyAdapter.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Configurable adapter for exercising FortStrategyExecutor's pure routing logic.
///         The executor transfers `amount` of tokenIn to this adapter, then calls execute().
///
///         data encoding: abi.encode(address outToken, uint256 mintAmount, uint256 reportAmount)
///         - If outToken != address(0) && mintAmount > 0: mints `mintAmount` of outToken
///           to the executor (msg.sender), simulating a swap/borrow output.
///         - Returns (outToken, reportAmount > 0 ? reportAmount : mintAmount).
///         - If outToken == address(0): keeps the received tokenIn (consume/supply-like)
///           and returns (address(0), 0).
///
///         Records the last received amount/token for assertions.
contract MockStrategyAdapter is IStrategyAdapter {
    uint256 public lastAmountIn;
    address public lastToken;
    IStrategyAdapter.ActionType public lastAction;
    uint256 public callCount;

    function execute(
        ActionType action,
        address token,
        uint256 amount,
        address /* beneficiary */,
        bytes calldata data
    ) external returns (address tokenOut, uint256 amountOut) {
        lastAmountIn = amount;
        lastToken = token;
        lastAction = action;
        callCount++;

        (address outToken, uint256 mintAmount, uint256 reportAmount) = abi
            .decode(data, (address, uint256, uint256));

        if (outToken == address(0)) {
            // Consume the received input (e.g. supply-like). No liquid output.
            return (address(0), 0);
        }

        if (mintAmount > 0) {
            IMintable(outToken).mint(msg.sender, mintAmount);
        }

        uint256 reported = reportAmount > 0 ? reportAmount : mintAmount;
        return (outToken, reported);
    }
}
