// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortStrategyExecutor.sol";
import "../mocks/MockUSDC.sol";

/// @notice Handler that wraps FortStrategyExecutor admin ops for invariant fuzzing.
contract ExecutorHandler is Test {
    FortStrategyExecutor public executor;

    constructor(FortStrategyExecutor _executor) {
        executor = _executor;
    }

    /// @notice Register a random adapter id → address.
    function registerAdapter(uint8 adapterId, address addr) external {
        if (addr == address(0)) return;
        try executor.registerAdapter(adapterId, addr) {} catch {}
    }

    /// @notice Remove an adapter.
    function removeAdapter(uint8 adapterId) external {
        try executor.removeAdapter(adapterId) {} catch {}
    }

    /// @notice Toggle pause.
    function togglePause(bool doPause) external {
        if (doPause) {
            try executor.pause() {} catch {}
        } else {
            try executor.unpause() {} catch {}
        }
    }
}

contract FortStrategyExecutorInvariantTest is Test {
    FortStrategyExecutor internal executor;
    MockUSDC internal usdc;
    ExecutorHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();

        FortStrategyExecutor impl = new FortStrategyExecutor();
        bytes memory initData = abi.encodeCall(FortStrategyExecutor.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        executor = FortStrategyExecutor(address(proxy));

        handler = new ExecutorHandler(executor);
        targetContract(address(handler));
    }

    /// @notice Executor should never hold USDC (stateless relay).
    function invariant_executorHoldsNoTokens() public view {
        assertEq(usdc.balanceOf(address(executor)), 0, "executor holds USDC");
    }
}
