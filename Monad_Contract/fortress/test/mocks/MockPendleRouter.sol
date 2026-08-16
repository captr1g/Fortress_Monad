// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IPendleRouter.sol";

/// @notice Mock Pendle Router for unit testing.
///         Simulates PT buy/sell at configurable rate. Uses a mock PT token.
///         Also provides mockSwap / mockRevert helpers for PendleStrategyAdapter tests.
contract MockPendleRouter {
    using SafeERC20 for IERC20;

    IERC20 public usdc;
    IERC20 public ptToken;

    /// @notice rate = ptOut * 1e6 / usdcIn (for buy), usdcOut * 1e6 / ptIn (for sell)
    uint256 public rate;

    // Call recording
    uint256 public swapTokenForPtCount;
    uint256 public swapPtForTokenCount;
    uint256 public redeemPyCount;
    address public lastReceiver;
    uint256 public lastAmount;

    constructor(address _usdc, address _ptToken, uint256 _rate) {
        usdc = IERC20(_usdc);
        ptToken = IERC20(_ptToken);
        rate = _rate;
    }

    function setRate(uint256 _rate) external {
        rate = _rate;
    }

    function swapExactTokenForPt(
        address receiver,
        address, /* market */
        uint256, /* minPtOut */
        IPendleRouter.ApproxParams calldata, /* guessPtOut */
        IPendleRouter.TokenInput calldata input,
        IPendleRouter.LimitOrderData calldata /* limit */
    ) external returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm) {
        // Pull USDC from caller
        IERC20(input.tokenIn).safeTransferFrom(msg.sender, address(this), input.netTokenIn);

        // Calculate PT output
        netPtOut = (input.netTokenIn * rate) / 1e6;

        // Send PT to receiver
        ptToken.safeTransfer(receiver, netPtOut);

        swapTokenForPtCount++;
        lastReceiver = receiver;
        lastAmount = input.netTokenIn;

        netSyFee = 0;
        netSyInterm = 0;
    }

    function swapExactPtForToken(
        address receiver,
        address, /* market */
        uint256 exactPtIn,
        IPendleRouter.TokenOutput calldata, /* output */
        IPendleRouter.LimitOrderData calldata /* limit */
    ) external returns (uint256 netTokenOut, uint256 netSyFee, uint256 netSyInterm) {
        // Pull PT from caller
        ptToken.safeTransferFrom(msg.sender, address(this), exactPtIn);

        // Calculate USDC output
        netTokenOut = (exactPtIn * rate) / 1e6;

        // Send USDC to receiver
        usdc.safeTransfer(receiver, netTokenOut);

        swapPtForTokenCount++;
        lastReceiver = receiver;
        lastAmount = exactPtIn;

        netSyFee = 0;
        netSyInterm = 0;
    }

    function redeemPyToToken(
        address receiver,
        address, /* YT */
        uint256 netPyIn,
        IPendleRouter.TokenOutput calldata /* output */
    ) external returns (uint256 netTokenOut, uint256 netSyFee) {
        // Pull PT from caller
        ptToken.safeTransferFrom(msg.sender, address(this), netPyIn);

        // 1:1 redemption at maturity
        netTokenOut = netPyIn;

        // Send USDC to receiver
        usdc.safeTransfer(receiver, netTokenOut);

        redeemPyCount++;
        lastReceiver = receiver;
        lastAmount = netPyIn;

        netSyFee = 0;
    }

    /// @notice Generic swap for PendleStrategyAdapter unit tests.
    ///         Pulls `amountIn` of `tokenIn` from caller, sends `amountOut` of `tokenOut` to caller.
    function mockSwap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    /// @notice Unconditionally reverts — used to test error propagation.
    function mockRevert() external pure {
        revert("MockPendleRouter: forced revert");
    }
}

/// @notice Minimal mock of PendleLPWrapper for PendleStrategyAdapter unit tests.
///         Wraps lpToken 1:1 into wrappedLp.
contract MockLPWrapper {
    using SafeERC20 for IERC20;

    IERC20 public lpToken;
    IERC20 public wrappedLp;

    constructor(address _lpToken, address _wrappedLp) {
        lpToken = IERC20(_lpToken);
        wrappedLp = IERC20(_wrappedLp);
    }

    function wrap(address receiver, uint256 netLpIn) external {
        lpToken.safeTransferFrom(msg.sender, address(this), netLpIn);
        wrappedLp.safeTransfer(receiver, netLpIn);
    }
}
