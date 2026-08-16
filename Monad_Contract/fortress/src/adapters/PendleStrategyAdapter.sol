// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "../interfaces/IStrategyAdapter.sol";

interface IPendleLPWrapper {
    function wrap(address receiver, uint256 netLpIn) external;
}

/// @title PendleStrategyAdapter — adapter for Pendle operations (PT/YT/LP buy + LP wrap)
/// @notice Called by FortStrategyExecutor. Two sub-actions routed via the data field:
///
///         SUB-ACTION 0 — ROUTER RELAY (buy PT, buy YT, add LP):
///           Relays pre-built SDK calldata to the Pendle RouterV4.
///           Supports exact and full-balance input modes.
///
///         SUB-ACTION 1 — WRAP LP:
///           Wraps a Pendle LP token into a wrapped LP (1:1) via PendleLPWrapper.
///           Used to make LP tokens compatible with money markets (Morpho, Aave).
///
///         Security:
///           - Only the executor can call execute().
///           - Router relay: only the immutable Pendle Router is callable.
///           - Wrap: only owner-allowlisted wrapper addresses are callable.
///           - minAmountOut enforced on router relay; 1:1 verified on wrap.
///           - Approval hygiene, Pausable, ReentrancyGuard, rescueToken.
contract PendleStrategyAdapter is
    IStrategyAdapter,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    address public immutable pendleRouter;
    address public executor;

    mapping(address => bool) public isApprovedWrapper;
    mapping(bytes4 => bool) public isApprovedRouterSelector;

    error UnsupportedAction();
    error UnauthorizedSelector(bytes4 selector);
    error OnlyExecutor();
    error ZeroExecutor();
    error ZeroAddress();
    error ZeroBalance();
    error ZeroMinAmountOut();
    error UnauthorizedWrapper(address wrapper);
    error SlippageExceeded(uint256 received, uint256 minimum);
    error InvalidSubAction(uint8 subAction);

    event PendleSwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut
    );

    event LpWrapped(
        address indexed lpToken,
        address indexed wrapper,
        uint256 amount
    );

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address _pendleRouter) {
        if (_pendleRouter == address(0)) revert ZeroAddress();
        pendleRouter = _pendleRouter;
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

    function setApprovedWrapper(
        address wrapper,
        bool approved
    ) external onlyOwner {
        if (wrapper == address(0)) revert ZeroAddress();
        isApprovedWrapper[wrapper] = approved;
    }

    function setApprovedRouterSelector(
        bytes4 selector,
        bool approved
    ) external onlyOwner {
        isApprovedRouterSelector[selector] = approved;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Execute a Pendle operation.
    /// @dev data encoding (first byte selects sub-action):
    ///
    ///   Sub-action 0 (Router relay — buy PT/YT/LP):
    ///     abi.encode(uint8(0), address tokenOut, uint256 minAmountOut, bool useFullBalance, bytes routerCalldata)
    ///
    ///   Sub-action 1 (Wrap LP → wrapped LP):
    ///     abi.encode(uint8(1), address wrapper, address wrappedToken)
    function execute(
        ActionType action,
        address token,
        uint256 amount,
        address /* beneficiary */,
        bytes calldata data
    )
        external
        onlyExecutor
        whenNotPaused
        nonReentrant
        returns (address tokenOut, uint256 amountOut)
    {
        if (action != ActionType.SWAP) revert UnsupportedAction();

        uint8 subAction = abi.decode(data[:32], (uint8));

        if (subAction == 0) {
            return _routerRelay(token, amount, data);
        } else if (subAction == 1) {
            return _wrapLp(token, amount, data);
        }

        revert InvalidSubAction(subAction);
    }

    // ──────────────────────────── Sub-action 0: Router relay ────────────────────────────

    function _routerRelay(
        address token,
        uint256 amount,
        bytes calldata data
    ) internal returns (address tokenOut, uint256 amountOut) {
        (
            ,
            address outToken,
            uint256 minAmountOut,
            bool useFullBalance,
            bytes memory routerCalldata
        ) = abi.decode(data, (uint8, address, uint256, bool, bytes));

        if (outToken == address(0)) revert ZeroAddress();
        if (minAmountOut == 0) revert ZeroMinAmountOut();

        uint256 amountIn;
        if (useFullBalance) {
            amountIn = IERC20(token).balanceOf(address(this));
            if (amountIn == 0) revert ZeroBalance();
        } else {
            amountIn = amount;
        }

        IERC20(token).forceApprove(pendleRouter, amountIn);

        // Validate router calldata selector
        if (routerCalldata.length < 4) revert ZeroAddress();
        bytes4 selector = bytes4(routerCalldata);
        if (!isApprovedRouterSelector[selector]) revert UnauthorizedSelector(selector);

        uint256 balBefore = IERC20(outToken).balanceOf(address(this));

        (bool success, bytes memory returnData) = pendleRouter.call(
            routerCalldata
        );
        if (!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }

        uint256 received = IERC20(outToken).balanceOf(address(this)) -
            balBefore;
        if (received < minAmountOut)
            revert SlippageExceeded(received, minAmountOut);

        IERC20(token).forceApprove(pendleRouter, 0);

        IERC20(outToken).safeTransfer(executor, received);

        // Sweep residual input tokens back to executor (partial router fill protection).
        uint256 residualInput = IERC20(token).balanceOf(address(this));
        if (residualInput > 0) {
            IERC20(token).safeTransfer(executor, residualInput);
        }

        emit PendleSwapExecuted(
            token,
            outToken,
            amountIn,
            received,
            minAmountOut
        );

        return (outToken, received);
    }

    // ──────────────────────────── Sub-action 1: Wrap LP ────────────────────────────

    function _wrapLp(
        address token,
        uint256 /* amount */,
        bytes calldata data
    ) internal returns (address tokenOut, uint256 amountOut) {
        (, address wrapper, address wrappedToken) = abi.decode(
            data,
            (uint8, address, address)
        );

        if (wrapper == address(0) || wrappedToken == address(0))
            revert ZeroAddress();
        if (!isApprovedWrapper[wrapper]) revert UnauthorizedWrapper(wrapper);

        uint256 amountIn = IERC20(token).balanceOf(address(this));
        if (amountIn == 0) revert ZeroBalance();

        // Approve wrapper to pull LP tokens
        IERC20(token).forceApprove(wrapper, amountIn);

        uint256 balBefore = IERC20(wrappedToken).balanceOf(address(this));

        // Wrap 1:1 — receiver is this adapter so we can forward to executor
        IPendleLPWrapper(wrapper).wrap(address(this), amountIn);

        uint256 received = IERC20(wrappedToken).balanceOf(address(this)) -
            balBefore;

        // Verify 1:1 mint — a compliant wrapper must mint exactly amountIn
        if (received != amountIn) revert SlippageExceeded(received, amountIn);

        // Clear residual approval
        IERC20(token).forceApprove(wrapper, 0);

        // Forward to executor
        IERC20(wrappedToken).safeTransfer(executor, received);

        emit LpWrapped(token, wrapper, received);

        return (wrappedToken, received);
    }

    /// @notice Rescue tokens accidentally sent to adapter
    function rescueToken(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    // ──── UUPS ────

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ──── Storage Gap ────

    uint256[50] private __gap;
}
