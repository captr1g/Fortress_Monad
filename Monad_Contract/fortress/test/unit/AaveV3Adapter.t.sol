// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/AaveV3Adapter.sol";
import "../../src/interfaces/IAaveV3Pool.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockAaveV3.sol";

/// @title AaveV3Adapter unit tests
///
/// @dev The mock pool enforces the same four guards the real one does (inactive,
///      frozen, paused, supply cap), so every rejection test proves the adapter
///      rejects FIRST with a named error rather than letting Aave's anonymous
///      numeric revert bubble through. If the adapter's pre-checks were deleted,
///      these tests would still revert — but with the mock's error, not the
///      adapter's, and each assertion names which one it expects.
contract AaveV3AdapterTest is Test {
    AaveV3Adapter internal adapter;
    MockUSDC internal usdc;
    MockAavePool internal pool;
    MockAToken internal aToken;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    uint256 internal constant RAY = 1e27;

    function setUp() public {
        usdc = new MockUSDC();
        pool = new MockAavePool(address(usdc), 6);
        aToken = pool.aToken();

        adapter = _deployAdapter(address(usdc), address(pool), address(aToken));

        // The pool must hold underlying to satisfy withdrawals.
        usdc.mint(address(pool), 100_000_000e6);
    }

    function _deployAdapter(address _usdc, address _pool, address _aToken) internal returns (AaveV3Adapter) {
        AaveV3Adapter impl = new AaveV3Adapter(_usdc, _pool, _aToken);
        return AaveV3Adapter(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(AaveV3Adapter.initialize, (owner, vault))))
        );
    }

    /// @dev Vault-side deposit: mint to the vault, approve the adapter, call.
    function _deposit(uint256 amount, address receiver) internal {
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, receiver);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                 WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice A deployment cannot be pointed at a mismatched market.
    function test_constructor_rejectsForeignAToken() public {
        MockAavePool otherPool = new MockAavePool(address(usdc), 6);
        // Resolved before arming the cheatcode: `otherPool.aToken()` is itself an
        // external call, and expectRevert applies to the very next one.
        address foreignAToken = address(otherPool.aToken());

        vm.expectRevert(AaveV3Adapter.WiringMismatch.selector);
        new AaveV3Adapter(address(usdc), address(pool), foreignAToken);
    }

    function test_constructor_rejectsWrongUnderlying() public {
        MockUSDC other = new MockUSDC();
        vm.expectRevert(AaveV3Adapter.WiringMismatch.selector);
        new AaveV3Adapter(address(other), address(pool), address(aToken));
    }

    function test_constructor_rejectsZeroAddress() public {
        vm.expectRevert(AaveV3Adapter.ZeroAddress.selector);
        new AaveV3Adapter(address(0), address(pool), address(aToken));
    }

    function test_initialize_zeroVault_reverts() public {
        AaveV3Adapter impl = new AaveV3Adapter(address(usdc), address(pool), address(aToken));
        vm.expectRevert(AaveV3Adapter.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(AaveV3Adapter.initialize, (owner, address(0))));
    }

    /// @notice One implementation, two markets — the Aave/Neverland shape.
    function test_twoMarkets_areIndependent() public {
        MockAavePool neverland = new MockAavePool(address(usdc), 6);
        MockAToken nToken = neverland.aToken();
        AaveV3Adapter nAdapter = _deployAdapter(address(usdc), address(neverland), address(nToken));
        usdc.mint(address(neverland), 100_000_000e6);

        _deposit(1000e6, user);

        usdc.mint(vault, 500e6);
        vm.startPrank(vault);
        usdc.approve(address(nAdapter), 500e6);
        nAdapter.depositFor(500e6, user);
        vm.stopPrank();

        assertEq(aToken.balanceOf(user), 1000e6, "Aave-side position");
        assertEq(nToken.balanceOf(user), 500e6, "Neverland-side position");
        assertEq(address(adapter.pool()), address(pool));
        assertEq(address(nAdapter.pool()), address(neverland));
    }

    /*//////////////////////////////////////////////////////////////
                          depositFor — HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_creditsReceiverDirectly() public {
        _deposit(1000e6, user);

        assertEq(aToken.balanceOf(user), 1000e6, "I2: position credited to the end user");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1: adapter holds no position");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1: adapter holds no underlying");
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_clearsApproval() public {
        _deposit(1000e6, user);
        assertEq(usdc.allowance(address(adapter), address(pool)), 0, "I7: approval revoked in the same tx");
    }

    function test_depositFor_emitsSupplied() public {
        usdc.mint(vault, 1000e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);
        vm.expectEmit(true, true, false, true, address(adapter));
        emit AaveV3Adapter.Supplied(vault, user, 1000e6, 1000e6);
        adapter.depositFor(1000e6, user);
        vm.stopPrank();
    }

    /// @notice aTokens rebase. With the index advanced, the credit is still measured
    ///         as a delta and the receiver's accrued interest does not break it.
    function test_depositFor_worksAfterIndexAccrual() public {
        _deposit(1000e6, user);
        aToken.setIndex((RAY * 11) / 10); // +10% interest

        uint256 balanceBefore = aToken.balanceOf(user);
        assertEq(balanceBefore, 1100e6, "existing position rebased up");

        _deposit(500e6, user);

        // ±1 unit, not exact: a scaled-balance round trip is `rayDiv` then `rayMul`,
        // both rounding half-up, so the reported balance can land one unit either
        // side of the amount supplied. This is the real Aave behaviour the adapter's
        // CREDIT_ROUNDING_TOLERANCE exists to absorb — at an index of 1.1 ray it
        // shows up here as 1,600,000,001 against a nominal 1,600,000,000.
        assertApproxEqAbs(aToken.balanceOf(user), 1600e6, 1, "accrued balance plus the new supply");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice A supply that lands exactly on the cap must be allowed through.
    function test_depositFor_atExactCapacity_succeeds() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 1000)); // 1000 USDC cap
        _deposit(1000e6, user);
        assertEq(aToken.balanceOf(user), 1000e6);
        assertEq(adapter.availableCapacity(), 0, "cap now exactly consumed");
    }

    /*//////////////////////////////////////////////////////////////
                          depositFor — REJECTIONS
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(AaveV3Adapter.OnlyVault.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_depositFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ZeroAmount.selector);
        adapter.depositFor(0, user);
    }

    function test_depositFor_zeroReceiver_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ZeroAddress.selector);
        adapter.depositFor(1000e6, address(0));
    }

    function test_depositFor_inactiveReserve_reverts() public {
        pool.setConfiguration(MockAaveConfig.build(6, false, false, false, 0));
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ReserveNotActive.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_depositFor_frozenReserve_reverts() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, true, false, 0));
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ReserveFrozen.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_depositFor_pausedReserve_reverts() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, true, 0));
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ReservePaused.selector);
        adapter.depositFor(1000e6, user);
    }

    /// @notice Aave would revert with the numeric string '51'. The adapter names it.
    function test_depositFor_overCap_revertsWithNamedError() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 1000)); // 1000 USDC
        _deposit(600e6, user);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(AaveV3Adapter.ProtocolAtCapacity.selector, 500e6, 400e6));
        adapter.depositFor(500e6, user);
    }

    /// @notice The receiver's credit is verified, not assumed from a successful call.
    function test_depositFor_underCredited_reverts() public {
        pool.setSupplyCreditBps(9000); // pool takes 1000, credits 900
        usdc.mint(vault, 1000e6);

        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(AaveV3Adapter.SupplyCreditShortfall.selector, 900e6, 1000e6));
        adapter.depositFor(1000e6, user);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                redeemFor
    //////////////////////////////////////////////////////////////*/

    function test_redeemFor_returnsUsdcToReceiver() public {
        _deposit(1000e6, user);

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(1000e6, receiver, user);

        assertEq(usdcOut, 1000e6);
        assertEq(usdc.balanceOf(receiver), 1000e6, "I2");
        assertEq(aToken.balanceOf(user), 0, "position fully burned");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
    }

    function test_redeemFor_partialPosition() public {
        _deposit(1000e6, user);

        vm.prank(user);
        aToken.approve(address(adapter), 400e6);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(400e6, user, user);

        assertEq(usdcOut, 400e6);
        assertEq(aToken.balanceOf(user), 600e6, "remainder stays supplied");
    }

    /// @notice The rebalance shape: receiver is the vault, owner is the user.
    function test_redeemFor_receiverDiffersFromOwner() public {
        _deposit(1000e6, user);

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.prank(vault);
        adapter.redeemFor(1000e6, vault, user);

        assertEq(usdc.balanceOf(vault), 1000e6, "USDC parked with the vault for the next leg");
    }

    function test_redeemFor_afterIndexAccrual() public {
        _deposit(1000e6, user);
        aToken.setIndex((RAY * 12) / 10); // +20%

        uint256 grown = aToken.balanceOf(user);
        assertEq(grown, 1200e6);

        vm.prank(user);
        aToken.approve(address(adapter), grown);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(grown, user, user);

        assertEq(usdcOut, 1200e6, "interest withdrawn along with principal");
        assertEq(aToken.balanceOf(address(adapter)), 0, "I1");
    }

    function test_redeemFor_emitsRedeemed() public {
        _deposit(1000e6, user);
        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.expectEmit(true, true, false, true, address(adapter));
        emit AaveV3Adapter.Redeemed(user, user, 1000e6, 1000e6);
        vm.prank(vault);
        adapter.redeemFor(1000e6, user, user);
    }

    /// @notice Freezing blocks new supply; it must NOT trap an existing position.
    function test_redeemFor_frozenReserve_stillAllowed() public {
        _deposit(1000e6, user);
        pool.setConfiguration(MockAaveConfig.build(6, true, true, false, 0));

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(1000e6, user, user);
        assertEq(usdcOut, 1000e6, "exit stays open on a frozen reserve");
    }

    function test_redeemFor_pausedReserve_reverts() public {
        _deposit(1000e6, user);
        pool.setConfiguration(MockAaveConfig.build(6, true, false, true, 0));

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ReservePaused.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_inactiveReserve_reverts() public {
        _deposit(1000e6, user);
        pool.setConfiguration(MockAaveConfig.build(6, false, false, false, 0));

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ReserveNotActive.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    /// @notice The pool's own return value is not taken on trust; the delta is.
    function test_redeemFor_poolUnderDelivers_reverts() public {
        _deposit(1000e6, user);
        pool.setWithdrawFillBps(9000);

        vm.prank(user);
        aToken.approve(address(adapter), 1000e6);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(AaveV3Adapter.WithdrawShortfall.selector, 900e6, 1000e6));
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(AaveV3Adapter.OnlyVault.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user);
    }

    function test_redeemFor_zeroOwner_reverts() public {
        vm.prank(vault);
        vm.expectRevert(AaveV3Adapter.ZeroAddress.selector);
        adapter.redeemFor(100e6, user, address(0));
    }

    function test_redeemFor_withoutApproval_reverts() public {
        _deposit(1000e6, user);
        vm.prank(vault);
        vm.expectRevert(MockAToken.InsufficientAllowance.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    /*//////////////////////////////////////////////////////////////
                            availableCapacity
    //////////////////////////////////////////////////////////////*/

    function test_availableCapacity_uncapped() public view {
        assertEq(adapter.availableCapacity(), type(uint256).max);
    }

    function test_availableCapacity_capped() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 1000));
        assertEq(adapter.availableCapacity(), 1000e6, "cap is in whole tokens, scaled by decimals");

        _deposit(250e6, user);
        assertEq(adapter.availableCapacity(), 750e6);
    }

    function test_availableCapacity_zeroWhenBlocked() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, true, false, 0));
        assertEq(adapter.availableCapacity(), 0, "frozen");

        pool.setConfiguration(MockAaveConfig.build(6, true, false, true, 0));
        assertEq(adapter.availableCapacity(), 0, "paused");

        pool.setConfiguration(MockAaveConfig.build(6, false, false, false, 0));
        assertEq(adapter.availableCapacity(), 0, "inactive");
    }

    function test_availableCapacity_zeroWhenOverCap() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 0));
        _deposit(2000e6, user);
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 1000)); // cap lowered below supply
        assertEq(adapter.availableCapacity(), 0, "no underflow when supply exceeds a lowered cap");
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN / RESCUE
    //////////////////////////////////////////////////////////////*/

    function test_setVault_emitsAndUpdates() public {
        address newVault = address(0xB0B);
        vm.expectEmit(true, true, false, false, address(adapter));
        emit AaveV3Adapter.VaultUpdated(vault, newVault);
        adapter.setVault(newVault);
        assertEq(adapter.vault(), newVault);
    }

    function test_setVault_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setVault(address(0xB0B));
    }

    function test_setVault_zero_reverts() public {
        vm.expectRevert(AaveV3Adapter.ZeroAddress.selector);
        adapter.setVault(address(0));
    }

    function test_rescueToken() public {
        usdc.mint(address(adapter), 100e6);
        adapter.rescueToken(address(usdc), address(0xCC), 100e6);
        assertEq(usdc.balanceOf(address(0xCC)), 100e6);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.rescueToken(address(usdc), user, 100e6);
    }
}
