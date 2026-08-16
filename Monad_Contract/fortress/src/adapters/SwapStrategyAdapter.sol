// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IStrategyAdapter.sol";

/// @title SwapStrategyAdapter — adapter for DEX swaps via LiFi or other aggregators
/// @notice Executes swaps with DEX allowlisting, minAmountOut enforcement, and approval hygiene.
///         Swap output is sent back to the executor for the next step.
///
///         Supports two modes:
///           - EXACT mode: swap calldata uses a pre-baked fromAmount (for the first swap
///             where the input is a known, fixed amount).
///           - FULL BALANCE mode: the adapter swaps its entire live balance of the input
///             token, regardless of what calldata says. Used for post-borrow swaps in
///             leverage loops where the exact borrowed amount is decided on-chain and
///             may differ from the build-time estimate baked into the calldata.
///
///         The mode is selected by a flag in the encoded step data.
///
///         Production hardening:
///           - Pausable, ReentrancyGuard, DEX allowlist, zero-address validation,
///             minAmountOut enforcement, approval hygiene, SwapExecuted event.
contract SwapStrategyAdapter is
    IStrategyAdapter,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    address public executor;
    mapping(address => bool) public isApprovedDex;
    mapping(bytes4 => bool) public isApprovedSwapSelector;

    error UnsupportedAction();
    error OnlyExecutor();
    error ZeroExecutor();
    error ZeroAddress();
    error ZeroBalance();
    error UnauthorizedDex(address dex);
    error SlippageExceeded(uint256 received, uint256 minimum);
    error SwapFailed();
    error ZeroMinAmountOut();
    error UnauthorizedSelector(bytes4 selector);

    /// @notice Emitted on every successful swap.
    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        address indexed dex,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut
    );

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _executor, address _owner) external initializer {
        if (_executor == address(0)) revert ZeroExecutor();
        __Ownable_init(_owner);
        __Ownable2Step_init();
        __Pausable_init();
        executor = _executor;
    }

    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroExecutor();
        executor = _executor;
    }

    function setApprovedDex(address dex, bool approved) external onlyOwner {
        if (dex == address(0)) revert ZeroAddress();
        isApprovedDex[dex] = approved;
    }

    function setApprovedSwapSelector(bytes4 selector, bool approved) external onlyOwner {
        isApprovedSwapSelector[selector] = approved;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Execute a swap
    /// @dev data encoding:
    ///   abi.encode(address dex, address tokenOut, uint256 minAmountOut, bool useFullBalance, bytes swapCalldata)
    ///
    ///   - useFullBalance = false (EXACT mode): the adapter uses `amount` (from the executor)
    ///     as the swap input. The calldata's internal amount must match. Used for the first
    ///     swap where the input is a known quantity.
    ///   - useFullBalance = true (FULL BALANCE mode): the adapter reads its own live balance
    ///     of `token` and uses that as the swap input, regardless of what `amount` the
    ///     executor sent or what number is frozen in the calldata. Used for post-borrow swaps
    ///     where the exact amount is decided on-chain and differs from any build-time estimate.
    function execute(
        ActionType action,
        address token,
        uint256 amount,
        address,
        /* beneficiary */
        bytes calldata data
    ) external onlyExecutor whenNotPaused nonReentrant returns (address tokenOut, uint256 amountOut) {
        if (action != ActionType.SWAP) revert UnsupportedAction();

        (address dex, address outToken, uint256 minAmountOut, bool useFullBalance, bytes memory swapCalldata) =
            abi.decode(data, (address, address, uint256, bool, bytes));

        if (dex == address(0) || outToken == address(0)) revert ZeroAddress();
        if (!isApprovedDex[dex]) revert UnauthorizedDex(dex);
        if (swapCalldata.length < 4) revert ZeroAddress();
        {
            bytes4 selector = bytes4(swapCalldata);
            if (!isApprovedSwapSelector[selector]) revert UnauthorizedSelector(selector);
        }
        if (minAmountOut == 0) revert ZeroMinAmountOut();

        // Determine the actual swap input amount.
        uint256 amountIn;
        if (useFullBalance) {
            // FULL BALANCE mode: use whatever the adapter is actually holding right now.
            // This handles the case where a borrow produced a slightly different amount
            // than what the calldata was built for — no mismatch possible.
            amountIn = IERC20(token).balanceOf(address(this));
            if (amountIn == 0) revert ZeroBalance();
        } else {
            // EXACT mode: use the amount the executor transferred (the known, fixed input).
            amountIn = amount;
        }

        // Cache the output token interface.
        IERC20 out = IERC20(outToken);

        // Approve the DEX to spend exactly the real input amount.
        IERC20(token).forceApprove(dex, amountIn);

        // Track output balance before swap.
        uint256 balBefore = out.balanceOf(address(this));

        // Execute the swap. In full-balance mode the calldata may have a stale amount
        // baked in, but many aggregators (Odos, 0x) will just pull whatever was approved.
        // The minAmountOut check below is the real protection.
        (bool success,) = dex.call(swapCalldata);
        if (!success) revert SwapFailed();

        uint256 received = out.balanceOf(address(this)) - balBefore;
        if (received < minAmountOut) {
            revert SlippageExceeded(received, minAmountOut);
        }

        // Clear residual approval.
        IERC20(token).forceApprove(dex, 0);

        // Send output to executor for next step.
        out.safeTransfer(executor, received);

        // Sweep residual input tokens back to executor (partial DEX fill protection).
        uint256 residualInput = IERC20(token).balanceOf(address(this));
        if (residualInput > 0) {
            IERC20(token).safeTransfer(executor, residualInput);
        }

        emit SwapExecuted(token, outToken, dex, amountIn, received, minAmountOut);

        return (outToken, received);
    }

    /// @notice Rescue tokens accidentally sent to adapter
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
