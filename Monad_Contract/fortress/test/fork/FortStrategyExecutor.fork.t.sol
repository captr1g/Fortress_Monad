// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/FortStrategyExecutor.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/interfaces/IFortStrategyExecutor.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockDex.sol";

/// @notice Extended Morpho interface exposing position + market param lookups used on-fork.
interface IMorphoBlueExtended {
    function idToMarketParams(bytes32 id)
        external
        view
        returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv);

    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);

    function setAuthorization(address authorized, bool newIsAuthorized) external;
}

contract FortStrategyExecutorForkTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    address constant yoUSD = 0x0000000f2eB9f69274678c76222B35eEc7588a65;
    bytes32 constant MARKET_ID = 0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137;

    uint8 internal constant SWAP_ID = 0;
    uint8 internal constant MORPHO_ID = 1;
    uint256 internal constant DEADLINE = type(uint256).max;

    FortStrategyExecutor internal executor;
    MorphoStrategyAdapter internal morphoAdapter;
    SwapStrategyAdapter internal swapAdapter;
    MockSwapTarget internal mockSwap;

    address internal user = address(0xA1);

    IMorphoBlue.MarketParams internal market;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // Read real market params from Morpho Blue.
        (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) =
            IMorphoBlueExtended(MORPHO_BLUE).idToMarketParams(MARKET_ID);
        market = IMorphoBlue.MarketParams({
            loanToken: loanToken,
            collateralToken: collateralToken,
            oracle: oracle,
            irm: irm,
            lltv: lltv
        });

        // Deploy executor (UUPS proxy).
        FortStrategyExecutor impl = new FortStrategyExecutor();
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(FortStrategyExecutor.initialize, ()));
        executor = FortStrategyExecutor(address(proxy));

        // Adapters (behind UUPS proxies).
        MorphoStrategyAdapter morphoImpl = new MorphoStrategyAdapter(MORPHO_BLUE);
        ERC1967Proxy morphoProxy = new ERC1967Proxy(
            address(morphoImpl), abi.encodeCall(MorphoStrategyAdapter.initialize, (address(executor), address(this)))
        );
        morphoAdapter = MorphoStrategyAdapter(address(morphoProxy));

        SwapStrategyAdapter swapImpl = new SwapStrategyAdapter();
        ERC1967Proxy swapProxy = new ERC1967Proxy(
            address(swapImpl), abi.encodeCall(SwapStrategyAdapter.initialize, (address(executor), address(this)))
        );
        swapAdapter = SwapStrategyAdapter(address(swapProxy));

        executor.registerAdapter(SWAP_ID, address(swapAdapter));
        executor.registerAdapter(MORPHO_ID, address(morphoAdapter));

        // Mock swap target that converts USDC -> yoUSD deterministically.
        mockSwap = new MockSwapTarget();
        swapAdapter.setApprovedDex(address(mockSwap), true);
        swapAdapter.setApprovedSwapSelector(MockSwapTarget.swap.selector, true);
        swapAdapter.setApprovedSwapSelector(MockSwapTarget.swapBalance.selector, true);
    }

    function _fundMockSwap(uint256 yoAmount) internal {
        deal(yoUSD, address(mockSwap), yoAmount);
    }

    function _swapStepData(uint256 amountIn, uint256 amountOut, uint256 minAmountOut)
        internal
        view
        returns (bytes memory)
    {
        bytes memory swapCalldata =
            abi.encodeCall(MockSwapTarget.swap, (USDC, amountIn, yoUSD, amountOut, address(swapAdapter)));
        return abi.encode(address(mockSwap), yoUSD, minAmountOut, false, swapCalldata);
    }

    /// @notice Swap-step data that consumes the adapter's whole tokenIn balance at a
    ///         fixed rate. Used for loop iterations where the borrowed amount is sized
    ///         on-chain and unknown at build time.
    function _swapBalanceData(address tokenIn, uint256 rateWad, uint256 minAmountOut)
        internal
        view
        returns (bytes memory)
    {
        bytes memory swapCalldata =
            abi.encodeCall(MockSwapTarget.swapBalance, (tokenIn, yoUSD, rateWad, address(swapAdapter)));
        return abi.encode(address(mockSwap), yoUSD, minAmountOut, true, swapCalldata);
    }

    // ──────────────────────────── (a) swap + supply ────────────────────────────

    function test_fork_swapAndSupply() public {
        uint256 inputAmount = 100e6; // 100 USDC
        uint256 yoOut = 90e6;

        deal(USDC, user, inputAmount);
        _fundMockSwap(yoOut);

        vm.prank(user);
        IERC20(USDC).approve(address(executor), inputAmount);
        vm.prank(user);
        IMorphoBlueExtended(MORPHO_BLUE).setAuthorization(address(morphoAdapter), true);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](2);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: SWAP_ID,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: USDC,
            bps: 10000,
            amountFixed: 0,
            data: _swapStepData(inputAmount, yoOut, yoOut)
        });
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: yoUSD,
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(market)
        });

        vm.prank(user);
        executor.executeStrategy(USDC, inputAmount, steps, new address[](0), DEADLINE);

        (,, uint128 collateral) = IMorphoBlueExtended(MORPHO_BLUE).position(MARKET_ID, user);
        assertGt(collateral, 0, "collateral should be positive");
    }

    // ──────────────────────────── (b) swap -> supply -> borrow ────────────────────────────

    function test_fork_oneLoop() public {
        uint256 inputAmount = 100e6;
        uint256 yoOut = 90e6;
        // Borrow to a conservative 10% LTV against the supplied collateral.
        uint256 targetLtv = 0.1e18;
        // The adapter sizes the borrow on-chain in the market's real loan-token
        // units; use a generous ceiling and assert the resulting position instead
        // of a hardcoded amount (the on-chain oracle math is the source of truth).
        uint256 maxBorrow = type(uint256).max;

        deal(USDC, user, inputAmount);
        _fundMockSwap(yoOut);

        vm.prank(user);
        IERC20(USDC).approve(address(executor), inputAmount);
        vm.prank(user);
        IMorphoBlueExtended(MORPHO_BLUE).setAuthorization(address(morphoAdapter), true);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](3);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: SWAP_ID,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: USDC,
            bps: 10000,
            amountFixed: 0,
            data: _swapStepData(inputAmount, yoOut, yoOut)
        });
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: yoUSD,
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(market)
        });
        steps[2] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.BORROW,
            tokenIn: USDC,
            bps: 0,
            amountFixed: 0,
            data: abi.encode(market, targetLtv, maxBorrow, uint256(0))
        });

        vm.prank(user);
        executor.executeStrategy(USDC, inputAmount, steps, new address[](0), DEADLINE);

        (, uint128 borrowShares, uint128 collateral) = IMorphoBlueExtended(MORPHO_BLUE).position(MARKET_ID, user);
        assertGt(collateral, 0, "collateral should be positive");
        assertGt(borrowShares, 0, "borrowShares should be positive");
    }

    // ──────────────────────────── (c) 17-step leverage loop ────────────────────────────

    function test_fork_leverageLoop() public {
        uint256 inputAmount = 100e6;

        deal(USDC, user, inputAmount);
        // Pre-fund the mock swap with plenty of yoUSD for repeated swaps.
        _fundMockSwap(10_000e6);

        vm.prank(user);
        IERC20(USDC).approve(address(executor), inputAmount);
        vm.prank(user);
        IMorphoBlueExtended(MORPHO_BLUE).setAuthorization(address(morphoAdapter), true);

        // Build a 17-step loop: initial swap+supply, then 5 iterations of
        // borrow -> swap -> supply (15 steps) = 17 steps total.
        // Each borrow is sized ON-CHAIN to a 50% target LTV against the live
        // collateral, so the post-borrow swap must consume whatever landed
        // (swapBalance) rather than a hardcoded amount.
        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](17);

        // Step 0: swap full 100 USDC -> ~90 yoUSD (≈0.9 yoUSD per USDC).
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: SWAP_ID,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: USDC,
            bps: 10000,
            amountFixed: 0,
            data: _swapStepData(inputAmount, 90e6, 1)
        });
        // Step 1: supply all yoUSD.
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: yoUSD,
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(market)
        });

        // 5 iterations of borrow(to 50% LTV) -> swap(all borrowed) -> supply.
        uint256 targetLtv = 0.5e18;
        uint256 maxBorrow = 1_000e6; // generous per-iteration ceiling
        uint256 rateWad = 0.9e18; // 0.9 yoUSD per 1 USDC
        uint256 idx = 2;
        for (uint256 i; i < 5; i++) {
            steps[idx] = IFortStrategyExecutor.Step({
                adapterId: MORPHO_ID,
                action: IStrategyAdapter.ActionType.BORROW,
                tokenIn: USDC,
                bps: 0,
                amountFixed: 0,
                data: abi.encode(market, targetLtv, maxBorrow, uint256(0))
            });
            idx++;
            steps[idx] = IFortStrategyExecutor.Step({
                adapterId: SWAP_ID,
                action: IStrategyAdapter.ActionType.SWAP,
                tokenIn: USDC,
                bps: 10000,
                amountFixed: 0,
                data: _swapBalanceData(USDC, rateWad, 1)
            });
            idx++;
            steps[idx] = IFortStrategyExecutor.Step({
                adapterId: MORPHO_ID,
                action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
                tokenIn: yoUSD,
                bps: 10000,
                amountFixed: 0,
                data: abi.encode(market)
            });
            idx++;
        }

        vm.prank(user);
        executor.executeStrategy(USDC, inputAmount, steps, new address[](0), DEADLINE);

        (, uint128 borrowShares, uint128 collateral) = IMorphoBlueExtended(MORPHO_BLUE).position(MARKET_ID, user);
        // Collateral should substantially exceed the initial ~90 yoUSD single supply.
        assertGt(collateral, 90e6, "leveraged collateral should exceed initial");
        assertGt(borrowShares, 0, "borrowShares should be positive");
    }

    // ──────────────────────────── (d) atomic revert ────────────────────────────

    function test_fork_atomicRevert_userUnchanged() public {
        uint256 inputAmount = 100e6;
        uint256 yoOut = 90e6;
        // Target an LTV above the market's liquidation LTV → adapter rejects it
        // (InvalidTargetLtv), so the whole strategy reverts atomically.
        uint256 targetLtv = 0.999e18;
        uint256 maxBorrow = type(uint256).max;

        deal(USDC, user, inputAmount);
        _fundMockSwap(yoOut);

        vm.prank(user);
        IERC20(USDC).approve(address(executor), inputAmount);
        vm.prank(user);
        IMorphoBlueExtended(MORPHO_BLUE).setAuthorization(address(morphoAdapter), true);

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](3);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: SWAP_ID,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: USDC,
            bps: 10000,
            amountFixed: 0,
            data: _swapStepData(inputAmount, yoOut, yoOut)
        });
        steps[1] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            tokenIn: yoUSD,
            bps: 10000,
            amountFixed: 0,
            data: abi.encode(market)
        });
        steps[2] = IFortStrategyExecutor.Step({
            adapterId: MORPHO_ID,
            action: IStrategyAdapter.ActionType.BORROW,
            tokenIn: USDC,
            bps: 0,
            amountFixed: 0,
            data: abi.encode(market, targetLtv, maxBorrow, uint256(0))
        });

        uint256 balBefore = IERC20(USDC).balanceOf(user);

        vm.prank(user);
        vm.expectRevert();
        executor.executeStrategy(USDC, inputAmount, steps, new address[](0), DEADLINE);

        // Whole tx reverted: user USDC unchanged.
        assertEq(IERC20(USDC).balanceOf(user), balBefore, "user USDC unchanged");
    }
}

/// @notice On-fork swap target. Pulls tokenIn from caller (the adapter) and sends
///         a deterministic amount of tokenOut to the recipient. Pre-funded via deal().
contract MockSwapTarget {
    function swap(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut, address recipient) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(recipient, amountOut);
    }

    /// @notice Consumes the caller's ENTIRE tokenIn balance (whatever the executor
    ///         forwarded) and pays out tokenOut at a fixed rate scaled by 1e18.
    ///         Used by loop tests where the borrowed amount is sized on-chain and is
    ///         therefore not known at calldata-build time.
    function swapBalance(address tokenIn, address tokenOut, uint256 rateWad, address recipient) external {
        uint256 amountIn = IERC20(tokenIn).balanceOf(msg.sender);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * rateWad) / 1e18;
        IERC20(tokenOut).transfer(recipient, amountOut);
    }
}
