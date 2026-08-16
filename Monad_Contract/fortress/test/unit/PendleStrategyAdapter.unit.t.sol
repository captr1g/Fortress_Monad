// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/PendleStrategyAdapter.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockPendleRouter.sol";

contract PendleStrategyAdapterUnitTest is Test {
    PendleStrategyAdapter internal adapter;
    MockPendleRouter internal router;
    MockUSDC internal usdc;
    MockERC20 internal ptToken;
    MockERC20 internal lpToken;
    MockERC20 internal wrappedLp;
    MockLPWrapper internal lpWrapper;

    address internal owner;
    address internal executorAddr = address(0xE);
    address internal nonOwner = address(0xBAD);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        ptToken = new MockERC20("PT-wcgUSD-18DEC2025", "PT-wcgUSD", 6);
        lpToken = new MockERC20("Pendle LP", "PENDLE-LP", 18);
        wrappedLp = new MockERC20(
            "Pendle Wrapped LP",
            "PENDLE-LPT-WRAPPED",
            18
        );
        router = new MockPendleRouter(address(usdc), address(ptToken), 1e6);
        lpWrapper = new MockLPWrapper(address(lpToken), address(wrappedLp));

        PendleStrategyAdapter impl = new PendleStrategyAdapter(address(router));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PendleStrategyAdapter.initialize, (executorAddr, owner))
        );
        adapter = PendleStrategyAdapter(address(proxy));

        // Approve the wrapper on the adapter
        adapter.setApprovedWrapper(address(lpWrapper), true);

        // Whitelist router selectors used in tests
        adapter.setApprovedRouterSelector(MockPendleRouter.mockSwap.selector, true);
        adapter.setApprovedRouterSelector(MockPendleRouter.mockRevert.selector, true);

        // Fund router with PT output reserve
        ptToken.mint(address(router), 10_000_000e6);
        // Fund LP wrapper with wrapped LP reserve
        wrappedLp.mint(address(lpWrapper), 10_000_000e18);
    }

    function _ownableErr(address who) internal pure returns (bytes memory) {
        return
            abi.encodeWithSelector(
                bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
                who
            );
    }

    function _buildData(
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut,
        bool useFullBalance
    ) internal view returns (bytes memory) {
        bytes memory routerCalldata = abi.encodeCall(
            MockPendleRouter.mockSwap,
            (address(usdc), amountIn, address(ptToken), amountOut)
        );
        return
            abi.encode(
                uint8(0), // sub-action 0 = router relay
                address(ptToken),
                minAmountOut,
                useFullBalance,
                routerCalldata
            );
    }

    // ──────────────────────────── happy path: exact mode ────────────────────────────

    function test_swap_exactMode_happyPath() public {
        uint256 amountIn = 1000e6;
        uint256 amountOut = 1050e6; // PT trades at discount
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _buildData(amountIn, amountOut, 1000e6, false);

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );

        assertEq(tokenOut, address(ptToken));
        assertEq(received, amountOut);
        assertEq(ptToken.balanceOf(executorAddr), amountOut);
        assertEq(usdc.allowance(address(adapter), address(router)), 0);
    }

    // ──────────────────────────── happy path: full balance mode ────────────────────────────

    function test_swap_fullBalanceMode_happyPath() public {
        uint256 amountIn = 500e6;
        uint256 amountOut = 520e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory routerCalldata = abi.encodeCall(
            MockPendleRouter.mockSwap,
            (address(usdc), amountIn, address(ptToken), amountOut)
        );
        bytes memory data = abi.encode(
            uint8(0),
            address(ptToken),
            uint256(500e6), // minAmountOut
            true, // useFullBalance
            routerCalldata
        );

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            0, // amount param ignored in full-balance mode
            address(0),
            data
        );

        assertEq(tokenOut, address(ptToken));
        assertEq(received, amountOut);
        assertEq(ptToken.balanceOf(executorAddr), amountOut);
    }

    // ──────────────────────────── full balance mode: zero balance reverts ────────────────────────────

    function test_swap_fullBalanceMode_zeroBalance_reverts() public {
        bytes memory routerCalldata = abi.encodeCall(
            MockPendleRouter.mockSwap,
            (address(usdc), 100e6, address(ptToken), 105e6)
        );
        bytes memory data = abi.encode(
            uint8(0),
            address(ptToken),
            uint256(1), // minAmountOut > 0
            true, // useFullBalance
            routerCalldata
        );

        vm.prank(executorAddr);
        vm.expectRevert(PendleStrategyAdapter.ZeroBalance.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            0,
            address(0),
            data
        );
    }

    // ──────────────────────────── onlyExecutor ────────────────────────────

    function test_swap_nonExecutor_reverts() public {
        bytes memory data = _buildData(100e6, 105e6, 100e6, false);
        vm.prank(nonOwner);
        vm.expectRevert(PendleStrategyAdapter.OnlyExecutor.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            100e6,
            address(0),
            data
        );
    }

    // ──────────────────────────── SlippageExceeded ────────────────────────────

    function test_swap_slippageExceeded_reverts() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 90e6; // router delivers 90
        uint256 minAmountOut = 100e6; // but we require 100
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _buildData(
            amountIn,
            amountOut,
            minAmountOut,
            false
        );

        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                PendleStrategyAdapter.SlippageExceeded.selector,
                amountOut,
                minAmountOut
            )
        );
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
    }

    // ──────────────────────────── PendleCallFailed ────────────────────────────

    function test_swap_routerReverts_bubblesReason() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory routerCalldata = abi.encodeCall(
            MockPendleRouter.mockRevert,
            ()
        );
        bytes memory data = abi.encode(
            uint8(0),
            address(ptToken),
            uint256(1), // minAmountOut > 0
            false,
            routerCalldata
        );

        vm.prank(executorAddr);
        vm.expectRevert("MockPendleRouter: forced revert");
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
    }

    // ──────────────────────────── UnsupportedAction ────────────────────────────

    function test_nonSwapAction_reverts() public {
        bytes memory data = _buildData(100e6, 105e6, 100e6, false);
        usdc.mint(address(adapter), 100e6);

        vm.prank(executorAddr);
        vm.expectRevert(PendleStrategyAdapter.UnsupportedAction.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            address(usdc),
            100e6,
            address(0),
            data
        );
    }

    // ──────────────────────────── paused ────────────────────────────

    function test_swap_whenPaused_reverts() public {
        adapter.pause();

        usdc.mint(address(adapter), 100e6);
        bytes memory data = _buildData(100e6, 105e6, 100e6, false);

        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()")))
        );
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            100e6,
            address(0),
            data
        );
    }

    function test_unpause_resumesExecution() public {
        adapter.pause();
        adapter.unpause();

        uint256 amountIn = 100e6;
        uint256 amountOut = 105e6;
        usdc.mint(address(adapter), amountIn);
        bytes memory data = _buildData(amountIn, amountOut, 100e6, false);

        vm.prank(executorAddr);
        (, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
        assertEq(received, amountOut);
    }

    // ──────────────────────────── admin ────────────────────────────

    function test_setExecutor_owner() public {
        address newExec = address(0xBEEF);
        adapter.setExecutor(newExec);
        assertEq(adapter.executor(), newExec);
    }

    function test_setExecutor_zero_reverts() public {
        vm.expectRevert(PendleStrategyAdapter.ZeroExecutor.selector);
        adapter.setExecutor(address(0));
    }

    function test_setExecutor_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.setExecutor(address(0xBEEF));
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.pause();
    }

    function test_rescueToken_owner() public {
        usdc.mint(address(adapter), 500e6);
        adapter.rescueToken(address(usdc), owner, 500e6);
        assertEq(usdc.balanceOf(owner), 500e6);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);
        vm.prank(nonOwner);
        vm.expectRevert(_ownableErr(nonOwner));
        adapter.rescueToken(address(usdc), nonOwner, 100e6);
    }

    // ──────────────────────────── constructor validation ────────────────────────────

    function test_constructor_zeroRouter_reverts() public {
        vm.expectRevert(PendleStrategyAdapter.ZeroAddress.selector);
        new PendleStrategyAdapter(address(0));
    }

    function test_constructor_zeroExecutor_reverts() public {
        PendleStrategyAdapter impl2 = new PendleStrategyAdapter(address(router));
        vm.expectRevert(PendleStrategyAdapter.ZeroExecutor.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(PendleStrategyAdapter.initialize, (address(0), owner))
        );
    }

    // ──────────────────────────── event emission ────────────────────────────

    function test_swap_emitsEvent() public {
        uint256 amountIn = 100e6;
        uint256 amountOut = 105e6;
        uint256 minOut = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _buildData(amountIn, amountOut, minOut, false);

        vm.prank(executorAddr);
        vm.expectEmit(true, true, false, true);
        emit PendleStrategyAdapter.PendleSwapExecuted(
            address(usdc),
            address(ptToken),
            amountIn,
            amountOut,
            minOut
        );
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
    }

    // ──────────────────────────── zero output token reverts ────────────────────────────

    function test_swap_zeroOutputToken_reverts() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory routerCalldata = abi.encodeCall(
            MockPendleRouter.mockSwap,
            (address(usdc), amountIn, address(ptToken), 105e6)
        );
        bytes memory data = abi.encode(
            uint8(0),
            address(0), // zero output token
            uint256(100e6),
            false,
            routerCalldata
        );

        vm.prank(executorAddr);
        vm.expectRevert(PendleStrategyAdapter.ZeroAddress.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
    }

    // ──────────────────────────── zero minAmountOut reverts ────────────────────────────

    function test_swap_zeroMinAmountOut_reverts() public {
        uint256 amountIn = 100e6;
        usdc.mint(address(adapter), amountIn);

        bytes memory data = _buildData(amountIn, 105e6, 0, false);

        vm.prank(executorAddr);
        vm.expectRevert(PendleStrategyAdapter.ZeroMinAmountOut.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );
    }

    // ──────────────────────────── wrap LP: happy path ────────────────────────────

    function test_wrapLp_happyPath() public {
        uint256 amount = 100e18;
        lpToken.mint(address(adapter), amount);

        bytes memory data = abi.encode(
            uint8(1),
            address(lpWrapper),
            address(wrappedLp)
        );

        vm.prank(executorAddr);
        (address tokenOut, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(lpToken),
            amount,
            address(0),
            data
        );

        assertEq(tokenOut, address(wrappedLp));
        assertEq(received, amount); // 1:1 wrap
        assertEq(wrappedLp.balanceOf(executorAddr), amount);
        assertEq(lpToken.allowance(address(adapter), address(lpWrapper)), 0);
    }

    // ──────────────────────────── wrap LP: unauthorized wrapper reverts ────────────────────────────

    function test_wrapLp_unauthorizedWrapper_reverts() public {
        uint256 amount = 100e18;
        lpToken.mint(address(adapter), amount);
        address fakeWrapper = address(0xDEAD);

        bytes memory data = abi.encode(
            uint8(1),
            fakeWrapper,
            address(wrappedLp)
        );

        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                PendleStrategyAdapter.UnauthorizedWrapper.selector,
                fakeWrapper
            )
        );
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(lpToken),
            amount,
            address(0),
            data
        );
    }

    // ──────────────────────────── wrap LP: zero balance reverts ────────────────────────────

    function test_wrapLp_zeroBalance_reverts() public {
        bytes memory data = abi.encode(
            uint8(1),
            address(lpWrapper),
            address(wrappedLp)
        );

        vm.prank(executorAddr);
        vm.expectRevert(PendleStrategyAdapter.ZeroBalance.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(lpToken),
            0,
            address(0),
            data
        );
    }

    // ──────────────────────────── invalid sub-action reverts ────────────────────────────

    function test_invalidSubAction_reverts() public {
        usdc.mint(address(adapter), 100e6);
        bytes memory data = abi.encode(uint8(99), address(ptToken), uint256(1));

        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                PendleStrategyAdapter.InvalidSubAction.selector,
                99
            )
        );
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            100e6,
            address(0),
            data
        );
    }

    // ──────────────────────────── residual input sweep (NM-012) ────────────────────────────

    function test_routerRelay_residualInputSwept() public {
        uint256 amountIn = 1000e6;
        uint256 extra = 200e6;
        uint256 amountOut = 1050e6;
        // Seed adapter with extra input (simulates partial router fill).
        usdc.mint(address(adapter), amountIn + extra);

        bytes memory data = _buildData(amountIn, amountOut, 1000e6, false);

        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            address(usdc),
            amountIn,
            address(0),
            data
        );

        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds residual input");
        assertEq(ptToken.balanceOf(executorAddr), amountOut, "output mismatch");
        assertEq(usdc.balanceOf(executorAddr), extra, "residual not swept to executor");
    }
}
