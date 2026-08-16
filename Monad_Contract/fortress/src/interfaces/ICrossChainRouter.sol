// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ICrossChainRouter — interface for cross-chain deposit/withdraw operations
/// @notice Standalone cross-chain routing. Does NOT modify FortVault's stateless model.
///         Deposits: USDC bridged via LiFi to destination chain + protocol.
///         Withdrawals: intent recorded on Base, keeper fulfills, user claims USDC.
interface ICrossChainRouter {
    enum RequestStatus { Pending, Completed, Failed, Refunded, Claimed, Cancelled }

    struct DepositRequest {
        address user;
        uint256 amount;
        uint256 destChainId;
        uint64 timestamp;
        RequestStatus status;
    }

    struct WithdrawRequest {
        address user;
        uint256 expectedAmount;
        uint256 actualAmount;
        uint256 minAcceptableAmount;
        uint256 sourceChainId;
        uint64 timestamp;
        RequestStatus status;
    }

    // ──── Cross-Chain Deposit ────

    /// @notice Initiate cross-chain deposit. Pulls USDC, bridges via LiFi.
    /// @param usdcAmount Amount of USDC to bridge + deposit
    /// @param destChainId Destination chain ID
    /// @param lifiData Raw calldata for LiFi Diamond (built by frontend via LiFi API)
    /// @param deadline Timestamp after which tx reverts
    /// @return requestId Unique identifier for tracking
    function depositCrossChain(
        uint256 usdcAmount,
        uint256 destChainId,
        bytes calldata lifiData,
        uint256 deadline
    ) external returns (bytes32 requestId);

    // ──── Cross-Chain Withdraw ────

    /// @notice Record withdrawal intent. Keeper handles destination chain execution.
    /// @param expectedUsdc Expected USDC to receive back
    /// @param minAcceptableAmount Minimum USDC the user will accept (slippage protection)
    /// @param sourceChainId Chain where shares are held
    /// @param deadline Timestamp after which tx reverts
    /// @return requestId Unique identifier for tracking
    function initiateWithdraw(
        uint256 expectedUsdc,
        uint256 minAcceptableAmount,
        uint256 sourceChainId,
        uint256 deadline
    ) external returns (bytes32 requestId);

    /// @notice Keeper: mark withdrawal as fulfilled after bridging USDC back
    /// @param requestId Request to fulfill
    /// @param actualAmount Actual USDC amount available for claim
    function fulfillWithdraw(bytes32 requestId, uint256 actualAmount) external;

    /// @notice Claim USDC from fulfilled withdrawal
    /// @param requestId Request to claim
    function claimWithdraw(bytes32 requestId) external;

    /// @notice Cancel a pending withdrawal request (user-callable)
    /// @param requestId Request to cancel
    function cancelWithdraw(bytes32 requestId) external;

    // ──── Deposit Status (Keeper) ────

    /// @notice Keeper: mark deposit as completed on destination chain
    function markDepositCompleted(bytes32 requestId) external;

    /// @notice Keeper: mark deposit as failed
    function markDepositFailed(bytes32 requestId) external;

    /// @notice Keeper: refund failed deposit (must send USDC to contract first)
    function refundDeposit(bytes32 requestId) external;

    // ──── View ────

    function getDepositRequest(bytes32 requestId) external view returns (DepositRequest memory);
    function getWithdrawRequest(bytes32 requestId) external view returns (WithdrawRequest memory);
}
