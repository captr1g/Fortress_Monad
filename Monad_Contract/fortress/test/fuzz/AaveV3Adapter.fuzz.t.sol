// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/AaveV3Adapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockAaveV3.sol";

/// @title AaveV3Adapter fuzz tests — amount, cap and index boundaries
/// @dev The properties that must hold for every amount and every liquidity index,
///      not just the ones the unit tests pick: the adapter never keeps a balance
///      (I1), the receiver is always credited (I2), and the cap guard's accept /
///      reject boundary matches the pool's own.
contract AaveV3AdapterFuzzTest is Test {
    AaveV3Adapter internal adapter;
    MockUSDC internal usdc;
    MockAavePool internal pool;
    MockAToken internal aToken;

    address internal vault = address(0xBA);
    address internal user = address(0xA1);
    uint256 internal constant RAY = 1e27;

    function setUp() public {
        usdc = new MockUSDC();
        pool = new MockAavePool(address(usdc), 6);
        aToken = pool.aToken();

        AaveV3Adapter impl = new AaveV3Adapter(address(usdc), address(pool), address(aToken));
        adapter = AaveV3Adapter(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(AaveV3Adapter.initialize, (address(this), vault))))
        );
        usdc.mint(address(pool), type(uint128).max);
    }

    function _deposit(uint256 amount, address receiver) internal {
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, receiver);
        vm.stopPrank();
    }

    /// @notice I1 + I2 for any amount: nothing sticks to the adapter, receiver credited.
    function testFuzz_depositFor_statelessAndCredited(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000e6);
        _deposit(amount, user);

        assertApproxEqAbs(aToken.balanceOf(user), amount, 1, "receiver credited");
        assertEq(aToken.balanceOf(address(adapter)), 0, "no position stuck");
        assertEq(usdc.balanceOf(address(adapter)), 0, "no underlying stuck");
        assertEq(usdc.allowance(address(adapter), address(pool)), 0, "I7: no residual approval");
    }

    /// @notice The credit check survives any liquidity index, i.e. any accrued state.
    function testFuzz_depositFor_anyIndex(uint256 amount, uint256 indexMul) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        // 1.0x .. 10.0x — an index only ever grows, and never below 1 ray.
        indexMul = bound(indexMul, 1e18, 10e18);
        aToken.setIndex((RAY / 1e18) * indexMul);

        _deposit(amount, user);

        // Tolerance scales with the index — the same bound the adapter derives.
        // A flat 1 is only correct while the index is near 1 ray.
        uint256 tol = aToken.index() / RAY + 1;
        assertApproxEqAbs(aToken.balanceOf(user), amount, tol, "credited despite the index");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice Round trip returns the principal for any amount.
    function testFuzz_depositThenRedeem_roundTrip(uint256 amount) public {
        amount = bound(amount, 1e6, 1_000_000_000e6);
        _deposit(amount, user);

        uint256 position = aToken.balanceOf(user);
        vm.prank(user);
        aToken.approve(address(adapter), position);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(position, user, user);

        assertApproxEqAbs(usdcOut, amount, 1, "principal returned");
        assertEq(usdc.balanceOf(user), usdcOut, "delivered to the receiver");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice The adapter's cap guard and the pool's own must agree on where the
    ///         boundary is. If the guard were looser the pool's anonymous revert
    ///         would leak through; if tighter, good deposits would be refused.
    function testFuzz_capGuard_matchesPool(uint256 capWholeTokens, uint256 supplied, uint256 amount) public {
        capWholeTokens = bound(capWholeTokens, 1, 1_000_000);
        uint256 capUnits = capWholeTokens * 1e6;
        supplied = bound(supplied, 0, capUnits);
        amount = bound(amount, 1, 2 * capUnits);

        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, capWholeTokens));
        if (supplied > 0) _deposit(supplied, user);

        uint256 capacity = adapter.availableCapacity();
        assertEq(capacity, capUnits - aToken.totalSupply(), "capacity is cap minus supplied");

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);

        if (amount > capacity) {
            vm.expectRevert(abi.encodeWithSelector(AaveV3Adapter.ProtocolAtCapacity.selector, amount, capacity));
            adapter.depositFor(amount, user);
        } else {
            // Must be accepted: the pool's own cap check has to agree.
            adapter.depositFor(amount, user);
        }
        vm.stopPrank();
    }

    /// @notice Partial redemptions leave the remainder supplied, never stranded.
    function testFuzz_redeemFor_partial(uint256 amount, uint256 redeemBps) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        redeemBps = bound(redeemBps, 1, 10_000);

        _deposit(amount, user);
        uint256 position = aToken.balanceOf(user);
        uint256 toRedeem = (position * redeemBps) / 10_000;
        vm.assume(toRedeem > 0);

        vm.prank(user);
        aToken.approve(address(adapter), toRedeem);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(toRedeem, user, user);

        assertApproxEqAbs(usdcOut, toRedeem, 1, "exactly what was burned");
        assertApproxEqAbs(aToken.balanceOf(user), position - toRedeem, 2, "remainder stays supplied");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
    }
}
