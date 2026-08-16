// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IStrategyAdapter.sol";

/// @title IFortStrategyExecutor — interface for the strategy execution engine
interface IFortStrategyExecutor {
    struct Step {
        uint8 adapterId;
        IStrategyAdapter.ActionType action;
        address tokenIn;
        uint16 bps; // basis points of executor's tokenIn balance to use (10000 = 100%)
        uint256 amountFixed; // if non-zero, overrides bps with a fixed amount
        bytes data; // adapter-specific encoded params
    }

    event StrategyExecuted(address indexed user, uint256 stepCount, uint256 gasUsed);
    event AdapterRegistered(uint8 indexed adapterId, address adapter);
    event AdapterRemoved(uint8 indexed adapterId);

    error DeadlineExpired();
    error ZeroAmount();
    error ZeroSteps();
    error TooManySteps();
    error AdapterNotRegistered(uint8 adapterId);
    error AdapterAlreadyRegistered(uint8 adapterId);
    error InsufficientOutput(uint256 expected, uint256 actual);
    error SweepFailed(address token);

    function executeStrategy(
        address inputToken,
        uint256 inputAmount,
        Step[] calldata steps,
        address[] calldata sweepTokens,
        uint256 deadline
    ) external;

    function registerAdapter(uint8 adapterId, address adapter) external;

    function removeAdapter(uint8 adapterId) external;

    function getAdapter(uint8 adapterId) external view returns (address);
}
