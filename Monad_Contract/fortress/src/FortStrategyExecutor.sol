// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFortStrategyExecutor.sol";
import "./interfaces/IStrategyAdapter.sol";

/// @title FortStrategyExecutor — atomic multi-step strategy execution engine
/// @notice Executes an ordered array of DeFi steps (swap, supply, borrow, etc.) in a single tx.
///         Each step routes to a registered adapter. Outputs chain between steps via balance reads.
///         Executor holds tokens only transiently — all residuals sweep to user at tx end.
contract FortStrategyExecutor is
    IFortStrategyExecutor,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardTransient
{
    using SafeERC20 for IERC20;

    uint8 public constant MAX_STEPS = 30;

    mapping(uint8 => address) public adapters;
    uint8[] public adapterIds;

    uint256[50] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __Ownable2Step_init();
        __Pausable_init();
    }

    // ══════════════════════════════════════════════════════════════
    //                    ADAPTER REGISTRY
    // ══════════════════════════════════════════════════════════════

    function registerAdapter(uint8 adapterId, address adapter) external onlyOwner {
        if (adapters[adapterId] != address(0)) {
            revert AdapterAlreadyRegistered(adapterId);
        }
        adapters[adapterId] = adapter;
        adapterIds.push(adapterId);
        emit AdapterRegistered(adapterId, adapter);
    }

    function removeAdapter(uint8 adapterId) external onlyOwner {
        if (adapters[adapterId] == address(0)) {
            revert AdapterNotRegistered(adapterId);
        }
        delete adapters[adapterId];
        for (uint256 i; i < adapterIds.length; i++) {
            if (adapterIds[i] == adapterId) {
                adapterIds[i] = adapterIds[adapterIds.length - 1];
                adapterIds.pop();
                break;
            }
        }
        emit AdapterRemoved(adapterId);
    }

    function getAdapter(uint8 adapterId) external view returns (address) {
        return adapters[adapterId];
    }

    function adapterCount() external view returns (uint256) {
        return adapterIds.length;
    }

    // ══════════════════════════════════════════════════════════════
    //                    STRATEGY EXECUTION
    // ══════════════════════════════════════════════════════════════

    /// @notice Execute a multi-step strategy atomically
    /// @param inputToken Token pulled from msg.sender at the start
    /// @param inputAmount Amount to pull (must be pre-approved to this contract)
    /// @param steps Ordered array of steps to execute
    /// @param sweepTokens Additional token addresses to sweep back to user at end
    /// @param deadline Timestamp after which the tx reverts
    function executeStrategy(
        address inputToken,
        uint256 inputAmount,
        Step[] calldata steps,
        address[] calldata sweepTokens,
        uint256 deadline
    ) external whenNotPaused nonReentrant {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (inputAmount == 0) revert ZeroAmount();
        if (steps.length == 0) revert ZeroSteps();
        if (steps.length > MAX_STEPS) revert TooManySteps();

        uint256 startGas = gasleft();

        // Pull initial tokens from user
        IERC20(inputToken).safeTransferFrom(msg.sender, address(this), inputAmount);

        // Execute each step sequentially, collect tokenOuts with delta-based verification.
        // Snapshots are taken AFTER the safeTransfer to the adapter so that delta
        // computation is correct even when tokenOut == tokenIn.
        address[] memory tokenOuts = new address[](steps.length);
        for (uint256 i; i < steps.length; i++) {
            address adapter = adapters[steps[i].adapterId];
            if (adapter == address(0)) revert AdapterNotRegistered(steps[i].adapterId);

            uint256 amount;
            bool isOutputOnly = steps[i].action == IStrategyAdapter.ActionType.BORROW
                || steps[i].action == IStrategyAdapter.ActionType.WITHDRAW_COLLATERAL;

            if (isOutputOnly) {
                amount = 0;
            } else {
                if (steps[i].amountFixed > 0) {
                    amount = steps[i].amountFixed;
                } else {
                    uint256 balance = IERC20(steps[i].tokenIn).balanceOf(address(this));
                    amount = (balance * steps[i].bps) / 10000;
                }
                if (amount == 0) revert ZeroAmount();
                IERC20(steps[i].tokenIn).safeTransfer(adapter, amount);
            }

            // Snapshot balances AFTER transfer for accurate delta verification
            uint256 inputSnap = IERC20(inputToken).balanceOf(address(this));
            uint256 tokenInSnap = IERC20(steps[i].tokenIn).balanceOf(address(this));
            uint256[] memory prevOutSnaps = new uint256[](i);
            for (uint256 j; j < i; j++) {
                if (tokenOuts[j] != address(0)) {
                    prevOutSnaps[j] = IERC20(tokenOuts[j]).balanceOf(address(this));
                }
            }

            (address tokenOut, uint256 amountOut) =
                IStrategyAdapter(adapter).execute(steps[i].action, steps[i].tokenIn, amount, msg.sender, steps[i].data);
            tokenOuts[i] = tokenOut;

            // Delta-based output verification
            if (tokenOut != address(0) && amountOut > 0) {
                uint256 balAfter = IERC20(tokenOut).balanceOf(address(this));
                uint256 balBefore;
                bool snapshotFound;

                if (tokenOut == inputToken) {
                    balBefore = inputSnap;
                    snapshotFound = true;
                } else if (tokenOut == steps[i].tokenIn) {
                    balBefore = tokenInSnap;
                    snapshotFound = true;
                } else {
                    for (uint256 j; j < i; j++) {
                        if (tokenOuts[j] == tokenOut) {
                            balBefore = prevOutSnaps[j];
                            snapshotFound = true;
                            break;
                        }
                    }
                }

                if (snapshotFound) {
                    if (balAfter - balBefore < amountOut) {
                        revert InsufficientOutput(amountOut, balAfter - balBefore);
                    }
                } else {
                    // First-seen token: use post-transfer snapshot as baseline
                    if (balAfter < amountOut) {
                        revert InsufficientOutput(amountOut, balAfter);
                    }
                }
            }
        }

        // Sweep step tokenOuts
        for (uint256 i; i < steps.length; i++) {
            if (tokenOuts[i] != address(0)) _sweepToken(tokenOuts[i], msg.sender);
        }
        // Sweep any residual tokens back to user
        _sweepToken(inputToken, msg.sender);
        for (uint256 i; i < steps.length; i++) {
            if (steps[i].tokenIn != inputToken) {
                _sweepToken(steps[i].tokenIn, msg.sender);
            }
        }
        // Sweep additional output tokens (e.g. tokenOut from intermediate steps)
        for (uint256 i; i < sweepTokens.length; i++) {
            _sweepToken(sweepTokens[i], msg.sender);
        }

        emit StrategyExecuted(msg.sender, steps.length, startGas - gasleft());
    }

    function _sweepToken(address token, address to) internal {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(to, balance);
        }
    }

    // ══════════════════════════════════════════════════════════════
    //                    ADMIN
    // ══════════════════════════════════════════════════════════════

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescue tokens accidentally sent to this contract
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
