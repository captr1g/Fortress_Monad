// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../../src/interfaces/IAerodromeRouter.sol";

/// @title MockAerodromeRouter — simulates Aerodrome Router for testing
contract MockAerodromeRouter is IAerodromeRouter {
    /// @notice Configurable swap rate: output = input * swapRate / 1e18
    uint256 public swapRate;

    /// @notice LP token minted on addLiquidity
    address public lpToken;

    uint256 public swapCallCount;
    uint256 public addLiquidityCallCount;
    uint256 public removeLiquidityCallCount;

    constructor(uint256 _swapRate, address _lpToken) {
        swapRate = _swapRate;
        lpToken = _lpToken;
    }

    function setSwapRate(uint256 _swapRate) external {
        swapRate = _swapRate;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external override returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "expired");
        swapCallCount++;

        // Pull input token
        IERC20(routes[0].from).transferFrom(msg.sender, address(this), amountIn);

        // Calculate output
        uint256 amountOut = (amountIn * swapRate) / 1e18;
        require(amountOut >= amountOutMin, "insufficient output");

        // Mint/transfer output token
        MockMintable(routes[routes.length - 1].to).mint(to, amountOut);

        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        amounts[routes.length] = amountOut;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        bool,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        require(block.timestamp <= deadline, "expired");
        addLiquidityCallCount++;

        // Pull tokens (use desired amounts, simulating no dust for simplicity)
        amountA = amountADesired;
        amountB = amountBDesired;
        require(amountA >= amountAMin, "amountA below min");
        require(amountB >= amountBMin, "amountB below min");

        IERC20(tokenA).transferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountB);

        // Mint LP tokens (liquidity = amountA + amountB for simplicity)
        liquidity = amountA + amountB;
        MockMintable(lpToken).mint(to, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override returns (uint256 amountA, uint256 amountB) {
        require(block.timestamp <= deadline, "expired");
        removeLiquidityCallCount++;

        // Burn LP tokens
        MockMintable(lpToken).burn(msg.sender, liquidity);

        // Return tokens split 50/50
        amountA = liquidity / 2;
        amountB = liquidity - amountA;
        require(amountA >= amountAMin, "amountA below min");
        require(amountB >= amountBMin, "amountB below min");

        MockMintable(tokenA).mint(to, amountA);
        MockMintable(tokenB).mint(to, amountB);
    }
}

/// @dev Helper interface for mock tokens that support mint/burn
interface MockMintable {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}
