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

contract FortStrategyExecutorUnitTest is Test {
    FortStrategyExecutor internal executor;
    MockStrategyAdapter internal mockAdapter; // id 0
    MockStrategyAdapter internal consumeAdapter; // id 1
    MockUSDC internal usdc;
    MockERC20 internal yoUSD;

    address internal owner;
    address internal nonOwner = address(0x1234);
    address internal user = address(0xA1);

    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);

        FortStrategyExecutor impl = new FortStrategyExecutor();
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(FortStrategyExecutor.initialize, ()));
        executor = FortStrategyExecutor(address(proxy));

        mockAdapter = new MockStrategyAdapter();
        consumeAdapter = new MockStrategyAdapter();
        executor.registerAdapter(0, address(mockAdapter));
        executor.registerAdapter(1, address(consumeAdapter));
    }

    function _fundAndApprove(address account, uint256 amount) internal {
        usdc.mint(account, amount);
        vm.prank(account);
        usdc.approve(address(executor), amount);
    }

    function _ownableErr(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), who);
    }

    // ──────────────────────────── initialize ────────────────────────────

    function test_initialize_setsOwner() public view {
        assertEq(executor.owner(), owner);
    }

    function test_initialize_twice_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("InvalidInitialization()"))));
        executor.initialize();
    }

    // ──────────────────────────── registerAdapter ────────────────────────────

    function test_registerAdapter_happy() public {
        MockStrategyAdapter a = new MockStrategyAdapter();
        vm.expectEmit(true, false, false, true);
        emit IFortStrategyExecutor.AdapterRegistered(5, address(a));
        executor.registerAdapter(5, address(a));
        assertEq(executor.getAdapter(5), address(a));
        assertEq(executor.adapterCount(), 3);
    }

    function test_registerAdapter_duplicate_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFortStrategyExecutor.AdapterAlreadyRegistered.selector, uint8(0)));
        executor.registerAdapter(0, address(mockAdapter));
    }

    function test_registerAdapter_nonOwner_reverts() public {
        MockStrategyAdapter a = new MockStrategyAdapter();
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        executor.registerAdapter(7, address(a));
    }

    // ──────────────────────────── removeAdapter ────────────────────────────

    function test_removeAdapter_happy() public {
        uint256 before = executor.adapterCount();
        vm.expectEmit(true, false, false, false);
        emit IFortStrategyExecutor.AdapterRemoved(0);
        executor.removeAdapter(0);
        assertEq(executor.getAdapter(0), address(0));
        assertEq(executor.adapterCount(), before - 1);
    }

    function test_removeAdapter_notFound_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IFortStrategyExecutor.AdapterNotRegistered.selector, uint8(99)));
        executor.removeAdapter(99);
    }

    function test_removeAdapter_cleansUpArray() public {
        assertEq(executor.adapterCount(), 2);
        executor.removeAdapter(0);
        assertEq(executor.adapterCount(), 1);
        // Remaining adapter still resolvable
        assertEq(executor.getAdapter(1), address(consumeAdapter));
        executor.removeAdapter(1);
        assertEq(executor.adapterCount(), 0);
    }

    function test_removeAdapter_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        executor.removeAdapter(0);
    }

    // ──────────────────────────── getAdapter ────────────────────────────

    function test_getAdapter_returnsCorrect() public view {
        assertEq(executor.getAdapter(0), address(mockAdapter));
        assertEq(executor.getAdapter(1), address(consumeAdapter));
        assertEq(executor.getAdapter(2), address(0));
    }

    // ──────────────────────────── executeStrategy guards ────────────────────────────

    function _consumeStep(uint8 id, address tokenIn, uint16 bps)
        internal
        pure
        returns (IFortStrategyExecutor.Step memory)
    {
        return IFortStrategyExecutor.Step({
            adapterId: id,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: tokenIn,
            bps: bps,
            amountFixed: 0,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });
    }

    function test_executeStrategy_deadlineExpired_reverts() public {
        _fundAndApprove(user, 100e6);
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 10000);

        vm.warp(1000);
        vm.prank(user);
        vm.expectRevert(IFortStrategyExecutor.DeadlineExpired.selector);
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), 999);
    }

    function test_executeStrategy_zeroAmount_reverts() public {
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 10000);

        vm.prank(user);
        vm.expectRevert(IFortStrategyExecutor.ZeroAmount.selector);
        executor.executeStrategy(address(usdc), 0, steps, new address[](0), DEADLINE);
    }

    function test_executeStrategy_zeroSteps_reverts() public {
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](0);
        vm.prank(user);
        vm.expectRevert(IFortStrategyExecutor.ZeroSteps.selector);
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), DEADLINE);
    }

    function test_executeStrategy_tooManySteps_reverts() public {
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](31);
        for (uint256 i; i < 31; i++) {
            steps[i] = _consumeStep(0, address(usdc), 10000);
        }
        vm.prank(user);
        vm.expectRevert(IFortStrategyExecutor.TooManySteps.selector);
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), DEADLINE);
    }

    function test_executeStrategy_unregisteredAdapter_reverts() public {
        _fundAndApprove(user, 100e6);
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(99, address(usdc), 10000);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(IFortStrategyExecutor.AdapterNotRegistered.selector, uint8(99)));
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), DEADLINE);
    }

    // ──────────────────────────── pause / unpause ────────────────────────────

    function test_pause_blocksExecuteStrategy() public {
        _fundAndApprove(user, 100e6);
        executor.pause();

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 10000);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()"))));
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), DEADLINE);
    }

    function test_unpause_restoresExecuteStrategy() public {
        _fundAndApprove(user, 100e6);
        executor.pause();
        executor.unpause();

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 10000);

        vm.prank(user);
        executor.executeStrategy(address(usdc), 100e6, steps, new address[](0), DEADLINE);
        // adapter received the input
        assertEq(mockAdapter.lastAmountIn(), 100e6);
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        executor.pause();
    }

    // ──────────────────────────── rescueToken ────────────────────────────

    function test_rescueToken_movesTokens() public {
        usdc.mint(address(executor), 500e6);
        address recipient = address(0xCC);
        executor.rescueToken(address(usdc), recipient, 500e6);
        assertEq(usdc.balanceOf(recipient), 500e6);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(executor), 500e6);
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        executor.rescueToken(address(usdc), nonOwner, 500e6);
    }

    // ──────────────────────────── upgrade auth ────────────────────────────

    function test_upgradeToAndCall_nonOwner_reverts() public {
        FortStrategyExecutor newImpl = new FortStrategyExecutor();
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        executor.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_owner_succeeds() public {
        FortStrategyExecutor newImpl = new FortStrategyExecutor();
        executor.upgradeToAndCall(address(newImpl), "");
    }

    // ──────────────────────────── balance chaining ────────────────────────────

    function test_balanceChaining_twoSteps() public {
        uint256 inputAmount = 100e6;
        _fundAndApprove(user, inputAmount);

        // Step 0: swap-like — consume USDC, mint 250e18 yoUSD to executor.
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](2);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: address(usdc),
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(address(yoUSD), uint256(250e18), uint256(0))
        });
        // Step 1: consume the full yoUSD balance produced by step 0.
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: 1,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: address(yoUSD),
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);

        // Step 0 received all input USDC
        assertEq(mockAdapter.lastAmountIn(), inputAmount);
        // Step 1 received the chained yoUSD output
        assertEq(consumeAdapter.lastAmountIn(), 250e18);
        // Nothing left stuck in executor
        assertEq(usdc.balanceOf(address(executor)), 0);
        assertEq(yoUSD.balanceOf(address(executor)), 0);
    }

    // ──────────────────────────── dust sweep ────────────────────────────

    function test_dustSweep_partialBpsReturnsResidualToUser() public {
        uint256 inputAmount = 100e6;
        _fundAndApprove(user, inputAmount);

        // Only 60% of USDC routed to the adapter; 40% residual must sweep back.
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 6000);

        vm.prank(user);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);

        assertEq(mockAdapter.lastAmountIn(), 60e6);
        // 40% swept back to user
        assertEq(usdc.balanceOf(user), 40e6);
        assertEq(usdc.balanceOf(address(executor)), 0);
    }

    // ──────────────────────────── InsufficientOutput ────────────────────────────

    function test_insufficientOutput_reverts() public {
        uint256 inputAmount = 100e6;
        _fundAndApprove(user, inputAmount);

        // Adapter mints only 100e18 but reports 200e18 as output.
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: address(usdc),
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(address(yoUSD), uint256(100e18), uint256(200e18))
        });

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(IFortStrategyExecutor.InsufficientOutput.selector, uint256(200e18), uint256(100e18))
        );
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);
    }

    // ──────────────────────────── amountFixed ────────────────────────────

    function test_amountFixed_usedExactly() public {
        uint256 inputAmount = 100e6;
        _fundAndApprove(user, inputAmount);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: 0,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: address(usdc),
            bps: 0,
            amountFixed: 30e6,
            data: abi.encode(address(0), uint256(0), uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);

        assertEq(mockAdapter.lastAmountIn(), 30e6);
        // 70 USDC residual swept back
        assertEq(usdc.balanceOf(user), 70e6);
    }

    function test_strategyExecuted_event() public {
        uint256 inputAmount = 100e6;
        _fundAndApprove(user, inputAmount);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = _consumeStep(0, address(usdc), 10000);

        vm.prank(user);
        vm.expectEmit(true, false, false, false);
        emit IFortStrategyExecutor.StrategyExecuted(user, 1, 0);
        executor.executeStrategy(address(usdc), inputAmount, steps, new address[](0), DEADLINE);
    }
}
