// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStrategyAdapter — interface for protocol adapters used by FortStrategyExecutor
/// @notice Each adapter handles one protocol's interactions (Morpho, LiFi, Aave, etc.)
interface IStrategyAdapter {
    enum ActionType {
        SWAP,
        SUPPLY_COLLATERAL,
        BORROW,
        REPAY,
        WITHDRAW_COLLATERAL,
        DEPOSIT_ERC4626,
        REDEEM_ERC4626
    }

    /// @notice Execute a single protocol action
    /// @param action The action type to perform
    /// @param token The input token for this action
    /// @param amount The input amount (already transferred to this adapter by the executor)
    /// @param beneficiary The end-user on whose behalf the action is performed
    /// @param data Protocol-specific encoded parameters
    /// @return tokenOut The output token produced by this action (address(0) if none)
    /// @return amountOut The output amount (0 if the action produces no liquid output to the executor)
    function execute(
        ActionType action,
        address token,
        uint256 amount,
        address beneficiary,
        bytes calldata data
    ) external returns (address tokenOut, uint256 amountOut);
}
