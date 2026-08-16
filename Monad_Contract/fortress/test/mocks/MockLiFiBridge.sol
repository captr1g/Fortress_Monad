// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mock LiFi Diamond for cross-chain bridge testing.
///         Simulates bridge by pulling USDC from caller. Configurable success/failure.
contract MockLiFiBridge {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;

    bool public shouldFail;
    uint256 public bridgeCallCount;
    uint256 public lastAmount;
    uint256 public lastDestChainId;
    address public lastReceiver;

    constructor(address _usdc) {
        usdc = IERC20(_usdc);
    }

    function setShouldFail(bool _fail) external {
        shouldFail = _fail;
    }

    /// @notice Simulates a LiFi bridge call. Pulls USDC from caller.
    /// @dev Test calldata: abi.encodeCall(MockLiFiBridge.bridgeTokens, (amount, destChainId, receiver))
    function bridgeTokens(
        uint256 amount,
        uint256 destChainId,
        address receiver
    ) external {
        require(!shouldFail, "bridge failed");

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        lastAmount = amount;
        lastDestChainId = destChainId;
        lastReceiver = receiver;
        bridgeCallCount++;
    }

    /// @notice Simulates a LiFi call that pulls some USDC but sends more back.
    ///         Used to test balance delta underflow protection.
    function bridgeAndReturn(uint256 pullAmount, uint256 returnAmount) external {
        if (pullAmount > 0) {
            usdc.safeTransferFrom(msg.sender, address(this), pullAmount);
        }
        if (returnAmount > 0) {
            usdc.safeTransfer(msg.sender, returnAmount);
        }
        bridgeCallCount++;
    }

    /// @notice No-op call that succeeds without touching USDC.
    function noop() external {
        bridgeCallCount++;
    }
}
