// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/AerodromeAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockAerodromeRouter.sol";
import "../mocks/MockAerodromeGauge.sol";

contract AerodromeAdapterTest is Test {
    AerodromeAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal pairedToken;
    MockUSDC internal lpToken;
    MockUSDC internal rewardToken;
    MockAerodromeRouter internal aeroRouter;
    MockAerodromeGauge internal gauge;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal factoryAddr = address(0xFA);

    bytes32 internal poolKey;
    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        usdc = new MockUSDC();
        pairedToken = new MockUSDC();
        lpToken = new MockUSDC();
        rewardToken = new MockUSDC();

        // Router: 1:1 swap rate (1e18)
        aeroRouter = new MockAerodromeRouter(1e18, address(lpToken));

        // Gauge: stakes lpToken, rewards rewardToken
        gauge = new MockAerodromeGauge(address(lpToken), address(rewardToken));

        AerodromeAdapter impl = new AerodromeAdapter(
            address(usdc),
            address(aeroRouter),
            factoryAddr
        );
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AerodromeAdapter.initialize, (owner, vault))
        );
        adapter = AerodromeAdapter(address(proxy));

        // Add pool
        adapter.addPool("USDC-WETH", address(lpToken), address(gauge), address(pairedToken), false);
        poolKey = keccak256(bytes("USDC-WETH"));
    }

    // ──── depositFor (no data) — reverts ────

    function test_depositFor_noData_reverts() public {
        vm.expectRevert(AerodromeAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_redeemFor_noData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AerodromeAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    // ──── depositFor (with data) ────

    function test_depositFor_withData() public {
        uint256 amount = 1000e6;

        usdc.mint(vault, amount);

        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();

        // Verify swap happened
        assertEq(aeroRouter.swapCallCount(), 1);
        // Verify liquidity added
        assertEq(aeroRouter.addLiquidityCallCount(), 1);
        // Verify gauge deposit
        assertEq(gauge.depositCallCount(), 1);
        // User should have gauge tokens
        assertGt(gauge.balanceOf(user), 0);
        // Adapter should hold nothing
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function test_depositFor_zeroAmount_reverts() public {
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.prank(vault);
        vm.expectRevert(AerodromeAdapter.ZeroAmount.selector);
        adapter.depositFor(0, user, data);
    }

    function test_depositFor_expiredDeadline_reverts() public {
        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), pastDeadline);

        usdc.mint(vault, 1000e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);

        vm.expectRevert(AerodromeAdapter.DeadlineExpired.selector);
        adapter.depositFor(1000e6, user, data);
        vm.stopPrank();
    }

    function test_depositFor_unauthorizedPool_reverts() public {
        bytes32 badPoolKey = keccak256(bytes("BAD-POOL"));
        bytes memory data = abi.encode(badPoolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        usdc.mint(vault, 1000e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);

        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.UnauthorizedPool.selector, badPoolKey));
        adapter.depositFor(1000e6, user, data);
        vm.stopPrank();
    }

    // ──── redeemFor (with data) ────

    function test_redeemFor_withData() public {
        uint256 depositAmount = 1000e6;

        // Deposit first
        usdc.mint(vault, depositAmount);
        bytes memory depositData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), depositAmount);
        adapter.depositFor(depositAmount, user, depositData);
        vm.stopPrank();

        // Get gauge balance
        uint256 gaugeBalance = gauge.balanceOf(user);
        assertGt(gaugeBalance, 0);

        // User approves adapter for gauge tokens
        vm.prank(user);
        gauge.approve(address(adapter), gaugeBalance);

        // Redeem
        bytes memory redeemData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);
        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(gaugeBalance, receiver, user, redeemData);

        assertGt(usdcOut, 0);
        assertEq(usdc.balanceOf(receiver), usdcOut);
        assertEq(gauge.balanceOf(user), 0);
        assertEq(aeroRouter.removeLiquidityCallCount(), 1);
    }

    function test_redeemFor_zeroShares_reverts() public {
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.prank(vault);
        vm.expectRevert(AerodromeAdapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user, data);
    }

    function test_redeemFor_expiredDeadline_reverts() public {
        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), pastDeadline);

        vm.prank(vault);
        vm.expectRevert(AerodromeAdapter.DeadlineExpired.selector);
        adapter.redeemFor(100e6, user, user, data);
    }

    // ──── depositFor edge cases ────

    function test_depositFor_emptyData_reverts() public {
        usdc.mint(vault, 1000e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);

        vm.expectRevert(AerodromeAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user, "");
        vm.stopPrank();
    }

    function test_depositFor_oddAmount() public {
        // Odd number: 1001e6 → halfUsdc=500500000, remainUsdc=500500000
        uint256 amount = 1001e6;

        usdc.mint(vault, amount);

        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();

        assertGt(gauge.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
        assertEq(pairedToken.balanceOf(address(adapter)), 0, "Adapter should hold zero paired");
    }

    function test_depositFor_multipleDeposits() public {
        uint256 amount1 = 500e6;
        uint256 amount2 = 300e6;

        usdc.mint(vault, amount1 + amount2);

        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount1 + amount2);
        adapter.depositFor(amount1, user, data);
        adapter.depositFor(amount2, user, data);
        vm.stopPrank();

        assertEq(aeroRouter.swapCallCount(), 2);
        assertEq(aeroRouter.addLiquidityCallCount(), 2);
        assertEq(gauge.depositCallCount(), 2);
    }

    function test_depositFor_afterPoolRemoved_reverts() public {
        adapter.removePool("USDC-WETH");

        usdc.mint(vault, 1000e6);
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);

        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.UnauthorizedPool.selector, poolKey));
        adapter.depositFor(1000e6, user, data);
        vm.stopPrank();
    }

    function test_depositFor_adapterHoldsNothing() public {
        uint256 amount = 2000e6;
        usdc.mint(vault, amount);

        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(adapter)), 0, "Adapter holds zero USDC");
        assertEq(pairedToken.balanceOf(address(adapter)), 0, "Adapter holds zero paired");
        assertEq(lpToken.balanceOf(address(adapter)), 0, "Adapter holds zero LP");
    }

    // ──── redeemFor edge cases ────

    function test_redeemFor_emptyData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AerodromeAdapter.InvalidData.selector);
        adapter.redeemFor(100e6, user, user, "");
    }

    function test_redeemFor_unauthorizedPool_reverts() public {
        bytes32 badPoolKey = keccak256(bytes("BAD-POOL"));
        bytes memory data = abi.encode(badPoolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.UnauthorizedPool.selector, badPoolKey));
        adapter.redeemFor(100e6, user, user, data);
    }

    function test_redeemFor_adapterHoldsNothing() public {
        uint256 depositAmount = 1000e6;

        // Deposit
        usdc.mint(vault, depositAmount);
        bytes memory depositData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), depositAmount);
        adapter.depositFor(depositAmount, user, depositData);
        vm.stopPrank();

        uint256 gaugeBalance = gauge.balanceOf(user);

        vm.prank(user);
        gauge.approve(address(adapter), gaugeBalance);

        bytes memory redeemData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);
        vm.prank(vault);
        adapter.redeemFor(gaugeBalance, user, user, redeemData);

        assertEq(usdc.balanceOf(address(adapter)), 0, "Adapter holds zero USDC");
        assertEq(pairedToken.balanceOf(address(adapter)), 0, "Adapter holds zero paired");
        assertEq(lpToken.balanceOf(address(adapter)), 0, "Adapter holds zero LP");
    }

    function test_redeemFor_noApproval_reverts() public {
        uint256 depositAmount = 1000e6;

        // Deposit
        usdc.mint(vault, depositAmount);
        bytes memory depositData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), depositAmount);
        adapter.depositFor(depositAmount, user, depositData);
        vm.stopPrank();

        uint256 gaugeBalance = gauge.balanceOf(user);

        // No gauge approval — should revert
        bytes memory redeemData = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), DEADLINE);
        vm.prank(vault);
        vm.expectRevert();
        adapter.redeemFor(gaugeBalance, user, user, redeemData);
    }

    // ──── Pool management ────

    function test_addPool() public {
        adapter.addPool("NEW-POOL", address(0x11), address(0x22), address(0x33), true);
        bytes32 newKey = keccak256(bytes("NEW-POOL"));

        (address pool, address g, address pt, bool stable) = adapter.pools(newKey);
        assertEq(pool, address(0x11));
        assertEq(g, address(0x22));
        assertEq(pt, address(0x33));
        assertEq(stable, true);
    }

    function test_addPool_duplicate_reverts() public {
        bytes32 key = keccak256(bytes("USDC-WETH"));
        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.PoolAlreadyExists.selector, key));
        adapter.addPool("USDC-WETH", address(0x11), address(0x22), address(0x33), false);
    }

    function test_removePool() public {
        adapter.removePool("USDC-WETH");

        (address pool,,,) = adapter.pools(poolKey);
        assertEq(pool, address(0));
    }

    function test_removePool_notFound_reverts() public {
        bytes32 key = keccak256(bytes("NONEXISTENT"));
        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.PoolNotFound.selector, key));
        adapter.removePool("NONEXISTENT");
    }

    function test_addPool_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            user
        ));
        adapter.addPool("X", address(0x11), address(0x22), address(0x33), false);
    }

    function test_removePool_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            user
        ));
        adapter.removePool("USDC-WETH");
    }

    function test_addPool_thenDeposit() public {
        // Add a second pool, deposit to it
        MockUSDC paired2 = new MockUSDC();
        MockUSDC lp2 = new MockUSDC();
        MockAerodromeGauge gauge2 = new MockAerodromeGauge(address(lp2), address(rewardToken));

        // Need new router pointing to lp2 — but we reuse existing router
        // The existing router mints lpToken, not lp2. So this tests pool config isolation.
        adapter.addPool("USDC-DAI", address(lpToken), address(gauge2), address(paired2), true);

        bytes32 daiKey = keccak256(bytes("USDC-DAI"));
        (address pool,,, bool stable) = adapter.pools(daiKey);
        assertEq(pool, address(lpToken));
        assertEq(stable, true);
    }

    // ──── claimRewards ────

    function test_claimRewards() public {
        gauge.setRewardAmount(50e18);

        adapter.claimRewards(poolKey, user);

        assertEq(gauge.getRewardCallCount(), 1);
        assertEq(rewardToken.balanceOf(user), 50e18);
    }

    function test_claimRewards_permissionless() public {
        // Anyone can call claimRewards, not just owner
        gauge.setRewardAmount(25e18);

        address randomCaller = address(0xDEAD);
        vm.prank(randomCaller);
        adapter.claimRewards(poolKey, user);

        assertEq(gauge.getRewardCallCount(), 1);
        assertEq(rewardToken.balanceOf(user), 25e18);
    }

    function test_claimRewards_unauthorizedPool_reverts() public {
        bytes32 badKey = keccak256(bytes("BAD"));
        vm.expectRevert(abi.encodeWithSelector(AerodromeAdapter.UnauthorizedPool.selector, badKey));
        adapter.claimRewards(badKey, user);
    }

    // ──── rescueToken ────

    function test_rescueToken() public {
        uint256 stuck = 100e6;
        usdc.mint(address(adapter), stuck);

        address recipient = address(0xCC);
        adapter.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(
            bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
            user
        ));
        adapter.rescueToken(address(usdc), user, 100e6);
    }

}
