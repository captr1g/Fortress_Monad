// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortStrategyExecutor.sol";
import "../../src/interfaces/IFortStrategyExecutor.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockStrategyAdapter.sol";

contract FortStrategyExecutorFuzzTest is Test {
    FortStrategyExecutor internal executor;
    MockStrategyAdapter internal adapter; // id 0
    MockUSDC internal usdc;
    MockERC20 internal yoUSD;

    address internal user = address(0xA1);
    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);

        FortStrategyExecutor impl = new FortStrategyExecutor();
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(FortStrategyExecutor.initialize, ()));
        executor = FortStrategyExecutor(address(proxy));

        adapter = new MockStrategyAdapter();
        executor.registerAdapter(0, address(adapter));
    }

    function _fundAndApprove(address account, uint256 amount) internal {
        usdc.mint(account, amount);
        vm.prank(account);
        usdc.approve(address(executor), amount);
    }

    /// bps split: amount used by adapter = balance * bps / 10000.
    function testFuzz_bpsSplit(uint256 balance, uint16 bps) public {
        balance = bound(balance, 1, 1e30);
        bps = uint16(bound(bps, 1, 10000));

        // Ensure the resulting amount is non-zero (executor reverts ZeroAmount otherwise).
        uint256 expected = (balance * bps) / 10000;
        vm.assume(expected > 0);

        _fundAndApprove(user, balance);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: address(usdc),
            bps: bps,
            amountFixed: 0,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(address(usdc), balance, steps, new address[](0), DEADLINE);

        assertEq(adapter.lastAmountIn(), expected);
        // Residual swept back to user.
        assertEq(usdc.balanceOf(user), balance - expected);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    /// After a full swap -> consume strategy + sweep, the executor holds zero of
    /// every token regardless of the (random) input amount.
    function testFuzz_balanceInvariant(uint256 inputAmount) public {
        inputAmount = bound(inputAmount, 1, 1e30);
        _fundAndApprove(user, inputAmount);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](2);
        // Step 0 — swap-like: consume USDC, mint a fixed yoUSD output to executor.
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: address(usdc),
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(address(yoUSD), uint256(1e18), uint256(0))
        });
        // Step 1 — consume the full yoUSD output (supply-like, no liquid output).
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: address(yoUSD),
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);

        // Executor holds nothing: USDC fully routed, yoUSD output fully consumed.
        assertEq(usdc.balanceOf(address(executor)), 0);
        assertEq(yoUSD.balanceOf(address(executor)), 0);
    }

    /// amountFixed is used exactly regardless of balance.
    function testFuzz_amountFixed(uint256 amt) public {
        uint256 inputAmount = 1e30;
        amt = bound(amt, 1, inputAmount);

        _fundAndApprove(user, inputAmount);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: address(usdc),
            bps: 0,
            amountFixed: amt,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);

        assertEq(adapter.lastAmountIn(), amt);
        assertEq(usdc.balanceOf(user), inputAmount - amt);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }
}
