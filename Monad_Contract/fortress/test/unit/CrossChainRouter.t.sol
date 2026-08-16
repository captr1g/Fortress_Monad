// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/CrossChainRouter.sol";
import "../../src/interfaces/ICrossChainRouter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiBridge.sol";

contract CrossChainRouterTest is Test {
    CrossChainRouter internal router;
    MockUSDC internal usdc;
    MockLiFiBridge internal bridge;

    address internal owner = address(this);
    address internal keeper = address(0xBEEF);
    address internal user = address(0xA1);
    address internal user2 = address(0xA2);

    uint256 internal constant DEADLINE = type(uint256).max;
    uint256 internal constant DEST_CHAIN_ARB = 42161;
    uint256 internal constant DEST_CHAIN_ETH = 1;

    function setUp() public {
        usdc = new MockUSDC();
        bridge = new MockLiFiBridge(address(usdc));

        CrossChainRouter impl = new CrossChainRouter(address(usdc), address(bridge));
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(CrossChainRouter.initialize, (keeper, owner)));
        router = CrossChainRouter(address(proxy));

        // Approve bridge selectors used in tests
        router.setApprovedBridgeSelector(MockLiFiBridge.bridgeTokens.selector, true);
        router.setApprovedBridgeSelector(MockLiFiBridge.bridgeAndReturn.selector, true);
        router.setApprovedBridgeSelector(MockLiFiBridge.noop.selector, true);
    }

    // ──────────── Helpers ────────────

    function _fundAndApprove(address _user, uint256 amount) internal {
        usdc.mint(_user, amount);
        vm.prank(_user);
        usdc.approve(address(router), amount);
    }

    function _buildBridgeData(uint256 amount, uint256 destChainId, address receiver)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodeCall(MockLiFiBridge.bridgeTokens, (amount, destChainId, receiver));
    }

    function _depositCrossChain(address _user, uint256 amount, uint256 destChainId)
        internal
        returns (bytes32 requestId)
    {
        _fundAndApprove(_user, amount);
        bytes memory lifiData = _buildBridgeData(amount, destChainId, _user);

        vm.prank(_user);
        requestId = router.depositCrossChain(amount, destChainId, lifiData, DEADLINE);
    }

    function _initiateWithdraw(address _user, uint256 expectedAmount, uint256 sourceChainId)
        internal
        returns (bytes32 requestId)
    {
        vm.prank(_user);
        requestId = router.initiateWithdraw(expectedAmount, 0, sourceChainId, DEADLINE);
    }

    // ══════════════════════════════════════════════════════════════
    //                    CONSTRUCTOR
    // ══════════════════════════════════════════════════════════════

    function test_constructor_setsState() public view {
        assertEq(address(router.usdc()), address(usdc));
        assertEq(router.lifiDiamond(), address(bridge));
        assertEq(router.owner(), owner);
        assertEq(router.keeper(), keeper);
    }

    function test_constructor_zeroUsdc_reverts() public {
        vm.expectRevert(CrossChainRouter.ZeroAddress.selector);
        new CrossChainRouter(address(0), address(bridge));
    }

    function test_constructor_zeroLifi_reverts() public {
        vm.expectRevert(CrossChainRouter.ZeroAddress.selector);
        new CrossChainRouter(address(usdc), address(0));
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT: HAPPY PATH
    // ══════════════════════════════════════════════════════════════

    function test_depositCrossChain_success() public {
        uint256 amount = 1000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        // Verify bridge was called
        assertEq(bridge.bridgeCallCount(), 1);
        assertEq(bridge.lastAmount(), amount);
        assertEq(bridge.lastDestChainId(), DEST_CHAIN_ARB);
        assertEq(bridge.lastReceiver(), user);

        // Verify request stored
        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(req.user, user);
        assertEq(req.amount, amount);
        assertEq(req.destChainId, DEST_CHAIN_ARB);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Pending));

        // Verify USDC flow: user → router → bridge
        assertEq(usdc.balanceOf(user), 0);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(usdc.balanceOf(address(bridge)), amount);
    }

    function test_depositCrossChain_multipleDeposits() public {
        bytes32 id1 = _depositCrossChain(user, 500e6, DEST_CHAIN_ARB);
        bytes32 id2 = _depositCrossChain(user, 300e6, DEST_CHAIN_ETH);

        assertTrue(id1 != id2);
        assertEq(bridge.bridgeCallCount(), 2);

        ICrossChainRouter.DepositRequest memory req1 = router.getDepositRequest(id1);
        ICrossChainRouter.DepositRequest memory req2 = router.getDepositRequest(id2);
        assertEq(req1.amount, 500e6);
        assertEq(req2.amount, 300e6);
        assertEq(req2.destChainId, DEST_CHAIN_ETH);
    }

    function test_depositCrossChain_emitsEvent() public {
        uint256 amount = 1000e6;
        _fundAndApprove(user, amount);
        bytes memory lifiData = _buildBridgeData(amount, DEST_CHAIN_ARB, user);

        // Calculate expected requestId (nonce=0 for first deposit)
        bytes32 expectedId = keccak256(abi.encodePacked(user, uint256(0), block.chainid));

        vm.prank(user);
        vm.expectEmit(true, true, false, true);
        emit CrossChainRouter.CrossChainDepositInitiated(expectedId, user, amount, DEST_CHAIN_ARB);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT: REVERTS
    // ══════════════════════════════════════════════════════════════

    function test_depositCrossChain_zeroAmount_reverts() public {
        vm.prank(user);
        vm.expectRevert(CrossChainRouter.ZeroAmount.selector);
        router.depositCrossChain(0, DEST_CHAIN_ARB, "", DEADLINE);
    }

    function test_depositCrossChain_expiredDeadline_reverts() public {
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        uint256 pastDeadline = block.timestamp - 1;
        vm.prank(user);
        vm.expectRevert(CrossChainRouter.DeadlineExpired.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, "", pastDeadline);
    }

    function test_depositCrossChain_liFiCallFails_reverts() public {
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        bridge.setShouldFail(true);
        bytes memory lifiData = _buildBridgeData(amount, DEST_CHAIN_ARB, user);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.LiFiCallFailed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    function test_depositCrossChain_usdcNotConsumed_reverts() public {
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        // Send empty calldata — bridge won't pull USDC, but call succeeds (fallback)
        // Actually, empty calldata to MockLiFiBridge will revert since no fallback
        // Use a different approach: call bridgeTokens with 0 amount
        bytes memory lifiData = _buildBridgeData(0, DEST_CHAIN_ARB, user);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.UsdcNotConsumed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    function test_depositCrossChain_whenPaused_reverts() public {
        router.pause();

        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        router.depositCrossChain(amount, DEST_CHAIN_ARB, "", DEADLINE);
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT: KEEPER STATUS UPDATES
    // ══════════════════════════════════════════════════════════════

    function test_markDepositCompleted() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositCompleted(requestId);

        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Completed));
    }

    function test_markDepositFailed() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Failed));
    }

    function test_markDepositCompleted_ownerCanCall() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        // Owner should also have keeper access
        router.markDepositCompleted(requestId);

        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Completed));
    }

    function test_markDepositCompleted_nonKeeper_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.OnlyKeeper.selector);
        router.markDepositCompleted(requestId);
    }

    function test_markDepositCompleted_notFound_reverts() public {
        bytes32 fakeId = keccak256("fake");

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.RequestNotFound.selector);
        router.markDepositCompleted(fakeId);
    }

    function test_markDepositCompleted_alreadyCompleted_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositCompleted(requestId);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.markDepositCompleted(requestId);
    }

    function test_markDepositFailed_alreadyCompleted_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositCompleted(requestId);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.markDepositFailed(requestId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    DEPOSIT: REFUND
    // ══════════════════════════════════════════════════════════════

    function test_refundDeposit_success() public {
        uint256 amount = 1000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        // Mark as failed
        vm.prank(keeper);
        router.markDepositFailed(requestId);

        // Keeper sends refund USDC to router
        usdc.mint(address(router), amount);

        vm.warp(block.timestamp + 24 hours + 1);

        // Refund
        vm.prank(keeper);
        router.refundDeposit(requestId);

        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Refunded));
        assertEq(usdc.balanceOf(user), amount);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_refundDeposit_notFailed_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 1000e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.refundDeposit(requestId);
    }

    function test_refundDeposit_insufficientBalance_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        vm.warp(block.timestamp + 24 hours + 1);

        // Don't send USDC to router
        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InsufficientBalance.selector);
        router.refundDeposit(requestId);
    }

    function test_refundDeposit_respectsPendingWithdrawBalance() public {
        // Setup: fulfill a withdrawal first so pendingWithdrawBalance > 0
        bytes32 wId = _initiateWithdraw(user2, 500e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 500e6);
        vm.prank(keeper);
        router.fulfillWithdraw(wId, 500e6);

        // Now deposit + fail
        bytes32 dId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);
        vm.prank(keeper);
        router.markDepositFailed(dId);

        // Send 1000e6 to router. Total = 500 (pending withdraw) + 1000 = 1500.
        // Free = 1500 - 500 = 1000. Enough for refund.
        usdc.mint(address(router), 1000e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        router.refundDeposit(dId);

        assertEq(usdc.balanceOf(user), 1000e6);
    }

    // ══════════════════════════════════════════════════════════════
    //                    WITHDRAW: HAPPY PATH
    // ══════════════════════════════════════════════════════════════

    function test_initiateWithdraw_success() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(req.user, user);
        assertEq(req.expectedAmount, 1000e6);
        assertEq(req.sourceChainId, DEST_CHAIN_ARB);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Pending));
        assertEq(req.actualAmount, 0);
    }

    function test_initiateWithdraw_emitsEvent() public {
        bytes32 expectedId = keccak256(abi.encodePacked(user, uint256(0), block.chainid));

        vm.prank(user);
        vm.expectEmit(true, true, false, true);
        emit CrossChainRouter.WithdrawInitiated(expectedId, user, 1000e6, DEST_CHAIN_ARB);
        router.initiateWithdraw(1000e6, 0, DEST_CHAIN_ARB, DEADLINE);
    }

    function test_fulfillWithdraw_success() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        // Keeper sends USDC + fulfills
        usdc.mint(address(router), 950e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 950e6);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Completed));
        assertEq(req.actualAmount, 950e6);
        assertEq(router.pendingWithdrawBalance(), 950e6);
    }

    function test_claimWithdraw_success() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        // Fulfill
        usdc.mint(address(router), 950e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 950e6);

        // Claim
        vm.prank(user);
        router.claimWithdraw(requestId);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Claimed));
        assertEq(usdc.balanceOf(user), 950e6);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertEq(router.pendingWithdrawBalance(), 0);
    }

    function test_fullWithdrawFlow_emitsAllEvents() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 1000e6);

        vm.prank(keeper);
        vm.expectEmit(true, false, false, true);
        emit CrossChainRouter.WithdrawFulfilled(requestId, 1000e6);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(user);
        vm.expectEmit(true, true, false, true);
        emit CrossChainRouter.WithdrawClaimed(requestId, user, 1000e6);
        router.claimWithdraw(requestId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    WITHDRAW: REVERTS
    // ══════════════════════════════════════════════════════════════

    function test_initiateWithdraw_zeroAmount_reverts() public {
        vm.prank(user);
        vm.expectRevert(CrossChainRouter.ZeroAmount.selector);
        router.initiateWithdraw(0, 0, DEST_CHAIN_ARB, DEADLINE);
    }

    function test_initiateWithdraw_expiredDeadline_reverts() public {
        vm.prank(user);
        vm.expectRevert(CrossChainRouter.DeadlineExpired.selector);
        router.initiateWithdraw(1000e6, 0, DEST_CHAIN_ARB, block.timestamp - 1);
    }

    function test_initiateWithdraw_whenPaused_reverts() public {
        router.pause();

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        router.initiateWithdraw(1000e6, 0, DEST_CHAIN_ARB, DEADLINE);
    }

    function test_fulfillWithdraw_nonKeeper_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.OnlyKeeper.selector);
        router.fulfillWithdraw(requestId, 1000e6);
    }

    function test_fulfillWithdraw_notFound_reverts() public {
        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.RequestNotFound.selector);
        router.fulfillWithdraw(keccak256("fake"), 1000e6);
    }

    function test_fulfillWithdraw_zeroAmount_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.ZeroAmount.selector);
        router.fulfillWithdraw(requestId, 0);
    }

    function test_fulfillWithdraw_insufficientBalance_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        // Don't send USDC to router
        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InsufficientBalance.selector);
        router.fulfillWithdraw(requestId, 1000e6);
    }

    function test_fulfillWithdraw_alreadyFulfilled_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.fulfillWithdraw(requestId, 1000e6);
    }

    function test_claimWithdraw_notOwner_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(user2);
        vm.expectRevert(CrossChainRouter.NotRequestOwner.selector);
        router.claimWithdraw(requestId);
    }

    function test_claimWithdraw_notCompleted_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.claimWithdraw(requestId);
    }

    function test_claimWithdraw_alreadyClaimed_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(user);
        router.claimWithdraw(requestId);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.claimWithdraw(requestId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    WITHDRAW: CANCEL
    // ══════════════════════════════════════════════════════════════

    function test_cancelWithdraw_success() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        router.cancelWithdraw(requestId);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Cancelled));
    }

    function test_cancelWithdraw_notOwner_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user2);
        vm.expectRevert(CrossChainRouter.NotRequestOwner.selector);
        router.cancelWithdraw(requestId);
    }

    function test_cancelWithdraw_alreadyFulfilled_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.cancelWithdraw(requestId);
    }

    function test_cancelWithdraw_emitsEvent() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        vm.expectEmit(true, false, false, false);
        emit CrossChainRouter.WithdrawCancelled(requestId);
        router.cancelWithdraw(requestId);
    }

    // ══════════════════════════════════════════════════════════════
    //                    OWNER: CONFIG
    // ══════════════════════════════════════════════════════════════

    function test_setKeeper() public {
        address newKeeper = address(0xCAFE);
        router.setKeeper(newKeeper);
        assertEq(router.keeper(), newKeeper);
    }

    function test_setKeeper_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        router.setKeeper(address(0xCAFE));
    }

    function test_setKeeper_zeroAddress_reverts() public {
        vm.expectRevert(CrossChainRouter.ZeroAddress.selector);
        router.setKeeper(address(0));
    }

    function test_setKeeper_emitsEvent() public {
        address newKeeper = address(0xCAFE);
        vm.expectEmit(true, true, false, false);
        emit CrossChainRouter.KeeperUpdated(keeper, newKeeper);
        router.setKeeper(newKeeper);
    }

    function test_pause_unpause() public {
        router.pause();
        assertTrue(router.paused());

        router.unpause();
        assertFalse(router.paused());
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        router.pause();
    }

    // ══════════════════════════════════════════════════════════════
    //                    EMERGENCY: RESCUE TOKEN
    // ══════════════════════════════════════════════════════════════

    function test_rescueToken_nonUsdc() public {
        MockUSDC otherToken = new MockUSDC();
        otherToken.mint(address(router), 500e6);

        address recipient = address(0xCC);
        router.rescueToken(address(otherToken), recipient, 500e6);

        assertEq(otherToken.balanceOf(recipient), 500e6);
    }

    function test_rescueToken_freeUsdc() public {
        // Send some USDC that isn't reserved for anything
        usdc.mint(address(router), 500e6);

        address recipient = address(0xCC);
        router.rescueToken(address(usdc), recipient, 500e6);

        assertEq(usdc.balanceOf(recipient), 500e6);
    }

    function test_rescueToken_cannotRescuePendingWithdrawUsdc() public {
        // Create pending withdrawal
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        // Try to rescue — should fail since all USDC is reserved
        vm.expectRevert(CrossChainRouter.InsufficientBalance.selector);
        router.rescueToken(address(usdc), owner, 1000e6);
    }

    function test_rescueToken_canRescueExcessUsdc() public {
        // Create pending withdrawal for 500
        bytes32 requestId = _initiateWithdraw(user, 500e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 800e6); // 800 total, 500 reserved
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 500e6);

        // Rescue 300 (free balance = 800 - 500 = 300)
        address recipient = address(0xCC);
        router.rescueToken(address(usdc), recipient, 300e6);
        assertEq(usdc.balanceOf(recipient), 300e6);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(router), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        router.rescueToken(address(usdc), user, 100e6);
    }

    // ══════════════════════════════════════════════════════════════
    //                    NONCE / REQUEST ID UNIQUENESS
    // ══════════════════════════════════════════════════════════════

    function test_requestIds_unique_acrossTypes() public {
        // Deposit and withdraw from same user should have different IDs
        bytes32 dId = _depositCrossChain(user, 100e6, DEST_CHAIN_ARB);
        bytes32 wId = _initiateWithdraw(user, 100e6, DEST_CHAIN_ARB);

        assertTrue(dId != wId);
        assertEq(router.nonces(user), 2);
    }

    function test_requestIds_unique_acrossUsers() public {
        bytes32 id1 = _depositCrossChain(user, 100e6, DEST_CHAIN_ARB);
        bytes32 id2 = _depositCrossChain(user2, 100e6, DEST_CHAIN_ARB);

        assertTrue(id1 != id2);
    }

    // ══════════════════════════════════════════════════════════════
    //                    INTEGRATION: FULL FLOWS
    // ══════════════════════════════════════════════════════════════

    function test_fullDepositFlow_depositToCompletedStatus() public {
        uint256 amount = 2000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        // Verify pending
        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Pending));

        // Keeper marks completed
        vm.prank(keeper);
        router.markDepositCompleted(requestId);

        req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Completed));
    }

    function test_fullDepositFlow_depositToFailedToRefund() public {
        uint256 amount = 2000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        // Mark failed
        vm.prank(keeper);
        router.markDepositFailed(requestId);

        // Send refund USDC
        usdc.mint(address(router), amount);

        vm.warp(block.timestamp + 24 hours + 1);

        // Refund
        vm.prank(keeper);
        router.refundDeposit(requestId);

        assertEq(usdc.balanceOf(user), amount);

        ICrossChainRouter.DepositRequest memory req = router.getDepositRequest(requestId);
        assertEq(uint8(req.status), uint8(ICrossChainRouter.RequestStatus.Refunded));
    }

    function test_fullWithdrawFlow_initiateToFulfillToClaim() public {
        uint256 expectedAmount = 1000e6;
        uint256 actualAmount = 980e6; // slight slippage

        bytes32 requestId = _initiateWithdraw(user, expectedAmount, DEST_CHAIN_ARB);

        // Keeper bridges USDC back + fulfills
        usdc.mint(address(router), actualAmount);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, actualAmount);

        // User claims
        vm.prank(user);
        router.claimWithdraw(requestId);

        assertEq(usdc.balanceOf(user), actualAmount);
        assertEq(router.pendingWithdrawBalance(), 0);
    }

    function test_concurrentWithdrawals() public {
        // Two users initiate withdrawals
        bytes32 id1 = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        bytes32 id2 = _initiateWithdraw(user2, 500e6, DEST_CHAIN_ETH);

        // Fulfill both
        usdc.mint(address(router), 1500e6);

        vm.startPrank(keeper);
        router.fulfillWithdraw(id1, 1000e6);
        router.fulfillWithdraw(id2, 500e6);
        vm.stopPrank();

        assertEq(router.pendingWithdrawBalance(), 1500e6);

        // Both claim
        vm.prank(user);
        router.claimWithdraw(id1);

        vm.prank(user2);
        router.claimWithdraw(id2);

        assertEq(usdc.balanceOf(user), 1000e6);
        assertEq(usdc.balanceOf(user2), 500e6);
        assertEq(router.pendingWithdrawBalance(), 0);
    }

    // ══════════════════════════════════════════════════════════════
    //                    EDGE CASES
    // ══════════════════════════════════════════════════════════════

    // --- Balance delta underflow protection ---

    function test_depositCrossChain_lifiReturnsUsdc_revertsGracefully() public {
        // LiFi call that sends USDC BACK to router → balAfter > balBefore
        // Must revert with UsdcNotConsumed, not arithmetic panic
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        // Pre-fund bridge so it can return USDC
        usdc.mint(address(bridge), 200e6);

        // bridgeAndReturn: pull 0, return 50 → router gains USDC → balAfter > balBefore
        bytes memory lifiData = abi.encodeCall(MockLiFiBridge.bridgeAndReturn, (0, 50e6));

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.UsdcNotConsumed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    function test_depositCrossChain_lifiPartialConsume_reverts() public {
        // LiFi pulls less than usdcAmount
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        // bridgeTokens with only 50e6 — pulls 50, but we deposited 100
        bytes memory lifiData = abi.encodeCall(MockLiFiBridge.bridgeTokens, (50e6, DEST_CHAIN_ARB, user));

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.UsdcNotConsumed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    function test_depositCrossChain_noopCall_reverts() public {
        // LiFi call succeeds but doesn't touch USDC at all
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        bytes memory lifiData = abi.encodeCall(MockLiFiBridge.noop, ());

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.UsdcNotConsumed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, lifiData, DEADLINE);
    }

    // --- Fulfill amount vs expected amount ---

    function test_fulfillWithdraw_actualMoreThanExpected_succeeds() public {
        // Keeper fulfills with more than user expected (favorable slippage)
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 1100e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1100e6);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(req.actualAmount, 1100e6);

        vm.prank(user);
        router.claimWithdraw(requestId);
        assertEq(usdc.balanceOf(user), 1100e6);
    }

    function test_fulfillWithdraw_actualLessThanExpected_succeeds() public {
        // Keeper fulfills with less than user expected (slippage)
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 800e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 800e6);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(req.actualAmount, 800e6);

        vm.prank(user);
        router.claimWithdraw(requestId);
        assertEq(usdc.balanceOf(user), 800e6);
    }

    // --- Fulfill after cancel ---

    function test_fulfillWithdraw_afterCancel_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        router.cancelWithdraw(requestId);

        usdc.mint(address(router), 1000e6);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.fulfillWithdraw(requestId, 1000e6);
    }

    // --- Double refund ---

    function test_refundDeposit_doubleRefund_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        usdc.mint(address(router), 2000e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        router.refundDeposit(requestId);

        // Second refund — status is Refunded, not Failed
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.refundDeposit(requestId);
    }

    // --- Mark completed then try refund ---

    function test_refundDeposit_afterCompleted_reverts() public {
        bytes32 requestId = _depositCrossChain(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositCompleted(requestId);

        usdc.mint(address(router), 1000e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.refundDeposit(requestId);
    }

    // --- Cancel then cancel again ---

    function test_cancelWithdraw_doubleCancelReverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        vm.prank(user);
        router.cancelWithdraw(requestId);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.cancelWithdraw(requestId);
    }

    // --- Claim then cancel (wrong order) ---

    function test_cancelWithdraw_afterClaim_reverts() public {
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);

        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        vm.prank(user);
        router.claimWithdraw(requestId);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.InvalidRequestStatus.selector);
        router.cancelWithdraw(requestId);
    }

    // --- Same-block request ID uniqueness ---

    function test_sameBlock_multipleOps_uniqueIds() public {
        // All in same block — different nonces → different IDs
        _fundAndApprove(user, 300e6);
        bytes memory lifiData1 = _buildBridgeData(100e6, DEST_CHAIN_ARB, user);
        bytes memory lifiData2 = _buildBridgeData(100e6, DEST_CHAIN_ETH, user);
        bytes memory lifiData3 = _buildBridgeData(100e6, DEST_CHAIN_ARB, user);

        vm.startPrank(user);
        bytes32 id1 = router.depositCrossChain(100e6, DEST_CHAIN_ARB, lifiData1, DEADLINE);
        bytes32 id2 = router.depositCrossChain(100e6, DEST_CHAIN_ETH, lifiData2, DEADLINE);
        bytes32 id3 = router.depositCrossChain(100e6, DEST_CHAIN_ARB, lifiData3, DEADLINE);
        vm.stopPrank();

        assertTrue(id1 != id2);
        assertTrue(id2 != id3);
        assertTrue(id1 != id3);
        assertEq(router.nonces(user), 3);
    }

    // --- Rescue when balance < pendingWithdrawBalance (underflow guard) ---

    function test_rescueUsdc_whenBalanceBelowPending_reverts() public {
        // Setup: fulfill a withdrawal, then simulate balance loss (burn)
        bytes32 requestId = _initiateWithdraw(user, 1000e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 1000e6);
        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1000e6);

        // pendingWithdrawBalance = 1000e6
        // Now simulate balance drift: burn some USDC from router
        vm.prank(address(router));
        usdc.transfer(address(0xDEAD), 500e6);

        // balance = 500e6, pendingWithdrawBalance = 1000e6
        // Rescue should revert with InsufficientBalance, NOT arithmetic panic
        vm.expectRevert(CrossChainRouter.InsufficientBalance.selector);
        router.rescueToken(address(usdc), owner, 1);
    }

    // --- Interleaved deposit + withdraw accounting ---

    function test_interleavedOps_accountingCorrect() public {
        // Deposit
        bytes32 dId = _depositCrossChain(user, 500e6, DEST_CHAIN_ARB);

        // Initiate withdraw
        bytes32 wId1 = _initiateWithdraw(user, 300e6, DEST_CHAIN_ARB);
        bytes32 wId2 = _initiateWithdraw(user2, 200e6, DEST_CHAIN_ETH);

        // Fulfill first withdraw
        usdc.mint(address(router), 300e6);
        vm.prank(keeper);
        router.fulfillWithdraw(wId1, 300e6);
        assertEq(router.pendingWithdrawBalance(), 300e6);

        // Mark deposit completed
        vm.prank(keeper);
        router.markDepositCompleted(dId);

        // Fulfill second withdraw
        usdc.mint(address(router), 200e6);
        vm.prank(keeper);
        router.fulfillWithdraw(wId2, 200e6);
        assertEq(router.pendingWithdrawBalance(), 500e6);

        // Claim first
        vm.prank(user);
        router.claimWithdraw(wId1);
        assertEq(router.pendingWithdrawBalance(), 200e6);
        assertEq(usdc.balanceOf(user), 300e6);

        // Claim second
        vm.prank(user2);
        router.claimWithdraw(wId2);
        assertEq(router.pendingWithdrawBalance(), 0);
        assertEq(usdc.balanceOf(user2), 200e6);

        // Router should have no USDC left
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    // --- Empty lifiData ---

    function test_depositCrossChain_emptyLifiData_reverts() public {
        // Empty calldata to a contract without fallback → call fails
        uint256 amount = 100e6;
        _fundAndApprove(user, amount);

        vm.prank(user);
        vm.expectRevert(CrossChainRouter.LiFiCallFailed.selector);
        router.depositCrossChain(amount, DEST_CHAIN_ARB, "", DEADLINE);
    }

    // --- Deposit refund: insufficient free balance due to pending withdrawals ---

    function test_refundDeposit_freeBalanceBlockedByWithdraws_reverts() public {
        // Fulfill a withdrawal first → USDC reserved
        bytes32 wId = _initiateWithdraw(user2, 500e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 500e6);
        vm.prank(keeper);
        router.fulfillWithdraw(wId, 500e6);

        // Deposit + fail
        bytes32 dId = _depositCrossChain(user, 300e6, DEST_CHAIN_ARB);
        vm.prank(keeper);
        router.markDepositFailed(dId);

        // Send 200e6 to router. Total = 500 (reserved) + 200 = 700. Free = 200.
        // Refund needs 300. Should fail.
        usdc.mint(address(router), 200e6);

        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.InsufficientBalance.selector);
        router.refundDeposit(dId);
    }

    // --- Keeper updated, old keeper loses access ---

    function test_setKeeper_oldKeeperLosesAccess() public {
        address newKeeper = address(0xCAFE);
        router.setKeeper(newKeeper);

        bytes32 requestId = _initiateWithdraw(user, 100e6, DEST_CHAIN_ARB);

        // Old keeper can't act
        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.OnlyKeeper.selector);
        router.fulfillWithdraw(requestId, 100e6);

        // New keeper can
        usdc.mint(address(router), 100e6);
        vm.prank(newKeeper);
        router.fulfillWithdraw(requestId, 100e6);
    }

    // --- Deposit with existing router USDC balance ---

    function test_depositCrossChain_withExistingBalance_works() public {
        // Router has 500e6 from fulfilled withdrawal
        bytes32 wId = _initiateWithdraw(user2, 500e6, DEST_CHAIN_ARB);
        usdc.mint(address(router), 500e6);
        vm.prank(keeper);
        router.fulfillWithdraw(wId, 500e6);

        // Deposit 200e6 — bridge should pull 200, not 700
        bytes32 dId = _depositCrossChain(user, 200e6, DEST_CHAIN_ARB);

        // Bridge got exactly 200
        assertEq(bridge.lastAmount(), 200e6);

        // Router still has 500 reserved for withdrawal
        assertEq(usdc.balanceOf(address(router)), 500e6);
        assertEq(router.pendingWithdrawBalance(), 500e6);
    }

    // ══════════════════════════════════════════════════════════════
    //                    SECURITY: KEEPER SLIPPAGE (H-2)
    // ══════════════════════════════════════════════════════════════

    function test_fulfillWithdraw_belowMinAcceptable_reverts() public {
        vm.prank(user);
        bytes32 requestId = router.initiateWithdraw(1000e6, 900e6, DEST_CHAIN_ARB, DEADLINE);

        usdc.mint(address(router), 800e6);

        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.SlippageTooHigh.selector);
        router.fulfillWithdraw(requestId, 800e6);
    }

    function test_fulfillWithdraw_exactMinAcceptable_succeeds() public {
        vm.prank(user);
        bytes32 requestId = router.initiateWithdraw(1000e6, 900e6, DEST_CHAIN_ARB, DEADLINE);

        usdc.mint(address(router), 900e6);

        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 900e6);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(req.actualAmount, 900e6);
    }

    function test_fulfillWithdraw_zeroMinAcceptable_noCheck() public {
        // minAcceptableAmount = 0 means no slippage check (backward compatible)
        vm.prank(user);
        bytes32 requestId = router.initiateWithdraw(1000e6, 0, DEST_CHAIN_ARB, DEADLINE);

        usdc.mint(address(router), 1e6); // very low amount

        vm.prank(keeper);
        router.fulfillWithdraw(requestId, 1e6);

        ICrossChainRouter.WithdrawRequest memory req = router.getWithdrawRequest(requestId);
        assertEq(req.actualAmount, 1e6);
    }

    // ══════════════════════════════════════════════════════════════
    //                    SECURITY: REFUND DELAY (H-3)
    // ══════════════════════════════════════════════════════════════

    function test_refundDeposit_tooEarly_reverts() public {
        uint256 amount = 1000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        usdc.mint(address(router), amount);

        // Try refund immediately — should fail
        vm.prank(keeper);
        vm.expectRevert(CrossChainRouter.RefundTooEarly.selector);
        router.refundDeposit(requestId);
    }

    function test_refundDeposit_exactDelay_succeeds() public {
        uint256 amount = 1000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        usdc.mint(address(router), amount);

        // Warp to exactly REFUND_DELAY — check is `<`, so exact boundary passes
        vm.warp(block.timestamp + 24 hours);

        vm.prank(keeper);
        router.refundDeposit(requestId);

        assertEq(usdc.balanceOf(user), amount);
    }

    function test_refundDeposit_afterDelay_succeeds() public {
        uint256 amount = 1000e6;
        bytes32 requestId = _depositCrossChain(user, amount, DEST_CHAIN_ARB);

        vm.prank(keeper);
        router.markDepositFailed(requestId);

        usdc.mint(address(router), amount);

        // Warp past REFUND_DELAY
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(keeper);
        router.refundDeposit(requestId);

        assertEq(usdc.balanceOf(user), amount);
    }
}
