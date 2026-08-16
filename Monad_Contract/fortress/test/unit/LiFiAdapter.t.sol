// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";

/// @title LiFiAdapter unit tests — rewritten for GenericSwapFacetV3
///
/// @dev These are NOT the Base tests re-pointed. The adapter's payload shape,
///      dispatch surface and allowlist model all changed (DECISIONS.md D0-5), so
///      the suite is rebuilt around three things the old one could not express:
///
///        1. **Variant dispatch.** `MockLiFiDiamond` records which of the six V3
///           functions was entered, so "the balance moved" is not accepted as
///           proof that the right facet was called.
///        2. **Native legs.** MON on either side, which the Base adapter had no
///           concept of and which the shMONAD path (Phase 4 task 13) needs.
///        3. **Fail-closed allowlists.** Selector checks, `approveTo` allowlisting,
///           and the route's end assets.
contract LiFiAdapterTest is Test {
    LiFiAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal diamond;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    /// @dev A leg's `callTo` is the DEX, never the diamond. Kept distinct from
    ///      `diamond` so a test cannot pass by conflating the two — which is how
    ///      the Base suite hid the inverted `approveTo` rule.
    address internal dex = address(0xDE);

    /// @dev Stand-in for a venue's swap entry point. Never executed: the mock
    ///      diamond simulates the leg rather than calling into it.
    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));

    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;

    uint8 internal constant K_SINGLE_E2E = uint8(LibLiFi.SwapKind.SingleERC20ToERC20);
    uint8 internal constant K_SINGLE_E2N = uint8(LibLiFi.SwapKind.SingleERC20ToNative);
    uint8 internal constant K_SINGLE_N2E = uint8(LibLiFi.SwapKind.SingleNativeToERC20);
    uint8 internal constant K_MULTI_E2E = uint8(LibLiFi.SwapKind.MultipleERC20ToERC20);
    uint8 internal constant K_MULTI_E2N = uint8(LibLiFi.SwapKind.MultipleERC20ToNative);
    uint8 internal constant K_MULTI_N2E = uint8(LibLiFi.SwapKind.MultipleNativeToERC20);

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6); // 1:1

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)));
        adapter = LiFiAdapter(payable(address(proxy)));

        adapter.setApprovedDex(dex, true);
        adapter.setApprovedSwapSelector(DEX_SELECTOR, true);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _leg(address from, address to, uint256 amount) internal view returns (LibSwap.SwapData memory) {
        return LibSwap.SwapData({
            callTo: dex,
            approveTo: dex,
            sendingAssetId: from,
            receivingAssetId: to,
            fromAmount: amount,
            callData: abi.encodePacked(DEX_SELECTOR),
            requiresDeposit: true
        });
    }

    function _route(address from, address to, uint256 amount) internal view returns (LibSwap.SwapData[] memory r) {
        r = new LibSwap.SwapData[](1);
        r[0] = _leg(from, to, amount);
    }

    /// @dev Two-leg route through an intermediate asset.
    function _route2(address from, address mid, address to, uint256 amount)
        internal
        view
        returns (LibSwap.SwapData[] memory r)
    {
        r = new LibSwap.SwapData[](2);
        r[0] = _leg(from, mid, amount);
        r[1] = _leg(mid, to, amount);
    }

    function _depositData(uint8 kind, address outputToken, LibSwap.SwapData[] memory route, uint256 minOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(kind, outputToken, route, minOut, DEADLINE);
    }

    function _redeemData(uint8 kind, address sourceToken, LibSwap.SwapData[] memory route, uint256 minOut)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(kind, sourceToken, route, minOut, DEADLINE);
    }

    /*//////////////////////////////////////////////////////////////
                         depositFor — HAPPY PATHS
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_singleERC20ToERC20() public {
        uint256 amount = 1000e6;
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), 900e6)
        );
        vm.stopPrank();

        assertEq(diamond.swapCallCount(), 1);
        assertEq(diamond.lastKind(), K_SINGLE_E2E, "dispatched to the single ERC20->ERC20 facet");
        // Output lands on the adapter first (delta measurement) and is forwarded.
        assertEq(diamond.lastReceiver(), address(adapter), "output routed via adapter, not the end user");
        assertEq(weth.balanceOf(user), amount, "user received output");
        assertEq(weth.balanceOf(address(adapter)), 0, "I1: adapter holds nothing");
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_multipleERC20ToERC20() public {
        uint256 amount = 1000e6;
        MockUSDC mid = new MockUSDC();
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount,
            user,
            _depositData(K_MULTI_E2E, address(weth), _route2(address(usdc), address(mid), address(weth), amount), 0)
        );
        vm.stopPrank();

        assertEq(diamond.lastKind(), K_MULTI_E2E, "dispatched to the multi-leg facet");
        assertEq(diamond.lastLegCount(), 2);
        assertEq(weth.balanceOf(user), amount);
    }

    /// @notice The shMONAD-shaped path: vault USDC out, native MON in.
    function test_depositFor_singleERC20ToNative() public {
        uint256 amount = 1000e6;
        vm.deal(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user, _depositData(K_SINGLE_E2N, NATIVE, _route(address(usdc), NATIVE, amount), 0));
        vm.stopPrank();

        assertEq(diamond.lastKind(), K_SINGLE_E2N);
        assertEq(user.balance, amount, "user received native MON");
        assertEq(address(adapter).balance, 0, "I1: no MON parked in the adapter");
    }

    function test_depositFor_multipleERC20ToNative() public {
        uint256 amount = 500e6;
        MockUSDC mid = new MockUSDC();
        vm.deal(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, _depositData(K_MULTI_E2N, NATIVE, _route2(address(usdc), address(mid), NATIVE, amount), 0)
        );
        vm.stopPrank();

        assertEq(diamond.lastKind(), K_MULTI_E2N);
        assertEq(user.balance, amount);
    }

    /// @notice I6 — the vault's amount wins over whatever the quote was built with.
    function test_depositFor_overridesFromAmount() public {
        uint256 vaultAmount = 500e6;
        weth.mint(address(diamond), vaultAmount);
        usdc.mint(vault, vaultAmount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), vaultAmount);
        adapter.depositFor(
            vaultAmount,
            user,
            _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), 9999e6), 0)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(diamond)), vaultAmount, "diamond pulled the vault amount, not 9999e6");
        assertEq(weth.balanceOf(user), vaultAmount);
    }

    /// @notice Requirement 10 — output is a pre/post delta, never an absolute balance.
    ///         Pre-existing output-token dust must not be counted as swap proceeds.
    function test_depositFor_deltaExcludesPreExistingOutputBalance() public {
        uint256 amount = 1000e6;
        uint256 dust = 777e6;
        weth.mint(address(diamond), amount);
        weth.mint(address(adapter), dust); // stranded from an earlier failure
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), 0)
        );
        vm.stopPrank();

        assertEq(weth.balanceOf(user), amount, "user got the swap output only, not the dust");
        assertEq(weth.balanceOf(address(adapter)), dust, "dust untouched, recoverable via rescueToken");
    }

    /// @notice The adapter's slippage check is its own, not a rename of the
    ///         diamond's. Proven by making the diamond under-deliver silently.
    function test_depositFor_slippageCaughtWhenDiamondDoesNotCheck() public {
        uint256 amount = 1000e6;
        uint256 minOut = 900e6;
        diamond.setRate(500_000); // 0.5x -> 500e6 out
        diamond.setIgnoreMinAmount(true);
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.SlippageExceeded.selector, 500e6, minOut));
        adapter.depositFor(
            amount,
            user,
            _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), minOut)
        );
        vm.stopPrank();
    }

    function test_depositFor_approvalClearedAfter() public {
        uint256 amount = 1000e6;
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), 0)
        );
        vm.stopPrank();

        assertEq(usdc.allowance(address(adapter), address(diamond)), 0, "I7: approval revoked in the same tx");
    }

    function test_depositFor_emitsSwapped() public {
        uint256 amount = 1000e6;
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        vm.expectEmit(true, true, true, true, address(adapter));
        emit LiFiAdapter.Swapped(user, address(usdc), address(weth), amount, amount);
        adapter.depositFor(
            amount, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), 0)
        );
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                         depositFor — REJECTIONS
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_noData_reverts() public {
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_depositFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.OnlyVault.selector);
        adapter.depositFor(
            1000e6, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), 1000e6), 0)
        );
    }

    function test_depositFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.ZeroAmount.selector);
        adapter.depositFor(
            0, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), 0), 0)
        );
    }

    function test_depositFor_expiredDeadline_reverts() public {
        bytes memory data = abi.encode(
            K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), 100e6), uint256(0), block.timestamp - 1
        );
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.depositFor(100e6, user, data);
    }

    /// @notice Vault-side input is always USDC, so a native-in variant is nonsense.
    function test_depositFor_nativeInKind_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.KindMismatch.selector);
        adapter.depositFor(
            100e6, user, _depositData(K_SINGLE_N2E, address(weth), _route(NATIVE, address(weth), 100e6), 0)
        );
    }

    function test_depositFor_unauthorizedCallTo_reverts() public {
        address badDex = address(0xDEAD);
        LibSwap.SwapData[] memory route = _route(address(usdc), address(weth), 100e6);
        route[0].callTo = badDex;

        usdc.mint(vault, 100e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedCallTo.selector, badDex));
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, address(weth), route, 0));
        vm.stopPrank();
    }

    /// @notice `approveTo` is now allowlisted, NOT compared to the diamond. The
    ///         Base rule (`approveTo == lifiDiamond`) rejected every live quote.
    function test_depositFor_unauthorizedApproveTo_reverts() public {
        address badTarget = address(0xBAAD);
        LibSwap.SwapData[] memory route = _route(address(usdc), address(weth), 100e6);
        route[0].approveTo = badTarget;

        usdc.mint(vault, 100e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 100e6);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedApproveTo.selector, badTarget));
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, address(weth), route, 0));
        vm.stopPrank();
    }

    /// @notice The diamond itself is not a valid leg target — that was the shape the
    ///         Base rule forced, and it is exactly what must not be allowlisted.
    function test_depositFor_diamondAsApproveTo_reverts() public {
        LibSwap.SwapData[] memory route = _route(address(usdc), address(weth), 100e6);
        route[0].approveTo = address(diamond);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedApproveTo.selector, address(diamond)));
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, address(weth), route, 0));
    }

    /// @notice I5 — an allowlisted router still exposes every other function it has.
    function test_depositFor_unauthorizedSelector_reverts() public {
        bytes4 bad = bytes4(keccak256("sweep(address)"));
        LibSwap.SwapData[] memory route = _route(address(usdc), address(weth), 100e6);
        route[0].callData = abi.encodePacked(bad);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedSelector.selector, bad));
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, address(weth), route, 0));
    }

    function test_depositFor_truncatedCallData_reverts() public {
        LibSwap.SwapData[] memory route = _route(address(usdc), address(weth), 100e6);
        route[0].callData = hex"aabb"; // under four bytes: no selector to check

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedSelector.selector, bytes4(0)));
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, address(weth), route, 0));
    }

    /// @notice The selector list ships empty and must fail closed.
    function test_selectorAllowlist_failsClosedBeforeConfiguration() public {
        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        LiFiAdapter fresh = LiFiAdapter(
            payable(address(new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)))))
        );
        fresh.setApprovedDex(dex, true); // addresses configured, selectors not

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedSelector.selector, DEX_SELECTOR));
        fresh.depositFor(
            100e6, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), 100e6), 0)
        );
    }

    function test_depositFor_singleKindWithTwoLegs_reverts() public {
        MockUSDC mid = new MockUSDC();
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.InvalidSwapCount.selector);
        adapter.depositFor(
            100e6,
            user,
            _depositData(K_SINGLE_E2E, address(weth), _route2(address(usdc), address(mid), address(weth), 100e6), 0)
        );
    }

    function test_depositFor_emptyRoute_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.InvalidSwapCount.selector);
        adapter.depositFor(100e6, user, _depositData(K_MULTI_E2E, address(weth), new LibSwap.SwapData[](0), 0));
    }

    /// @notice The route must actually end in the token the caller declared.
    function test_depositFor_routeEndAssetMismatch_reverts() public {
        MockUSDC other = new MockUSDC();
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.AssetMismatch.selector);
        adapter.depositFor(
            100e6, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(usdc), address(other), 100e6), 0)
        );
    }

    function test_depositFor_routeStartAssetMismatch_reverts() public {
        MockUSDC other = new MockUSDC();
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.AssetMismatch.selector);
        adapter.depositFor(
            100e6, user, _depositData(K_SINGLE_E2E, address(weth), _route(address(other), address(weth), 100e6), 0)
        );
    }

    function test_depositFor_outputIsUsdc_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.SameToken.selector);
        adapter.depositFor(
            100e6, user, _depositData(K_SINGLE_E2E, address(usdc), _route(address(usdc), address(usdc), 100e6), 0)
        );
    }

    /// @notice Declaring a native output while naming an ERC20 variant must not
    ///         silently fall through to the ERC20 facet.
    function test_depositFor_nativeOutputWithErc20Kind_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.KindMismatch.selector);
        adapter.depositFor(100e6, user, _depositData(K_SINGLE_E2E, NATIVE, _route(address(usdc), NATIVE, 100e6), 0));
    }

    function test_depositFor_invalidKindOrdinal_reverts() public {
        bytes memory data =
            abi.encode(uint8(6), address(weth), _route(address(usdc), address(weth), 100e6), uint256(0), DEADLINE);
        vm.prank(vault);
        vm.expectRevert(); // enum conversion is out of range
        adapter.depositFor(100e6, user, data);
    }

    /*//////////////////////////////////////////////////////////////
                                redeemFor
    //////////////////////////////////////////////////////////////*/

    function test_redeemFor_noData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_singleERC20ToERC20() public {
        uint256 shares = 500e6;
        address receiver = address(0xBB);
        usdc.mint(address(diamond), shares);
        weth.mint(user, shares);

        vm.prank(user);
        weth.approve(address(adapter), shares);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(
            shares,
            receiver,
            user,
            _redeemData(K_SINGLE_E2E, address(weth), _route(address(weth), address(usdc), shares), 400e6)
        );

        assertEq(diamond.lastKind(), K_SINGLE_E2E);
        assertEq(usdcOut, shares);
        assertEq(usdc.balanceOf(receiver), shares, "I2: USDC forwarded to the receiver");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
    }

    function test_redeemFor_multipleERC20ToERC20() public {
        uint256 shares = 500e6;
        MockUSDC mid = new MockUSDC();
        usdc.mint(address(diamond), shares);
        weth.mint(user, shares);

        vm.prank(user);
        weth.approve(address(adapter), shares);

        vm.prank(vault);
        adapter.redeemFor(
            shares,
            user,
            user,
            _redeemData(K_MULTI_E2E, address(weth), _route2(address(weth), address(mid), address(usdc), shares), 0)
        );

        assertEq(diamond.lastKind(), K_MULTI_E2E);
        assertEq(diamond.lastLegCount(), 2);
    }

    /// @notice Redeem output is USDC and the source is pulled with `transferFrom`,
    ///         so no native variant is reachable.
    function test_redeemFor_nativeKind_reverts() public {
        weth.mint(user, 100e6);
        vm.prank(user);
        weth.approve(address(adapter), 100e6);

        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.KindMismatch.selector);
        adapter.redeemFor(
            100e6, user, user, _redeemData(K_SINGLE_E2N, address(weth), _route(address(weth), address(usdc), 100e6), 0)
        );
    }

    function test_redeemFor_expiredDeadline_reverts() public {
        bytes memory data = abi.encode(
            K_SINGLE_E2E, address(weth), _route(address(weth), address(usdc), 100e6), uint256(0), block.timestamp - 1
        );
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.redeemFor(100e6, user, user, data);
    }

    function test_redeemFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.OnlyVault.selector);
        adapter.redeemFor(
            100e6, user, user, _redeemData(K_SINGLE_E2E, address(weth), _route(address(weth), address(usdc), 100e6), 0)
        );
    }

    /*//////////////////////////////////////////////////////////////
                                  swap()
    //////////////////////////////////////////////////////////////*/

    function test_swap_erc20ToErc20() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        uint256 received = adapter.swap(
            address(weth),
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(received, amount);
        assertEq(usdc.balanceOf(user), amount);
        assertEq(usdc.balanceOf(address(adapter)), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
    }

    function test_swap_erc20ToNative() public {
        uint256 amount = 1000e6;
        vm.deal(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(address(weth), amount, NATIVE, 0, DEADLINE, K_SINGLE_E2N, _route(address(weth), NATIVE, amount));
        vm.stopPrank();

        assertEq(diamond.lastKind(), K_SINGLE_E2N);
        assertEq(user.balance, amount);
        assertEq(address(adapter).balance, 0);
    }

    function test_swap_nativeToErc20() public {
        uint256 amount = 5 ether;
        usdc.mint(address(diamond), amount);
        vm.deal(user, amount);

        vm.prank(user);
        adapter.swap{value: amount}(
            NATIVE, amount, address(usdc), 0, DEADLINE, K_SINGLE_N2E, _route(NATIVE, address(usdc), amount)
        );

        assertEq(diamond.lastKind(), K_SINGLE_N2E);
        assertEq(diamond.lastValue(), amount, "MON forwarded as msg.value");
        assertEq(usdc.balanceOf(user), amount);
        assertEq(address(adapter).balance, 0, "I1: no MON left behind");
        assertEq(user.balance, 0);
    }

    function test_swap_multipleNativeToErc20() public {
        uint256 amount = 3 ether;
        MockUSDC mid = new MockUSDC();
        usdc.mint(address(diamond), amount);
        vm.deal(user, amount);

        vm.prank(user);
        adapter.swap{value: amount}(
            NATIVE,
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_MULTI_N2E,
            _route2(NATIVE, address(mid), address(usdc), amount)
        );

        assertEq(diamond.lastKind(), K_MULTI_N2E);
        assertEq(usdc.balanceOf(user), amount);
    }

    /// @notice Unspent native input goes back to the payer, not the next caller.
    function test_swap_nativeResidualReturnedToPayer() public {
        uint256 amount = 4 ether;
        uint256 refund = amount / 4; // 25% of the leg goes unfilled

        diamond.setNativeRefundBps(2500);
        usdc.mint(address(diamond), amount);
        vm.deal(user, amount);

        vm.prank(user);
        adapter.swap{value: amount}(
            NATIVE, amount, address(usdc), 0, DEADLINE, K_SINGLE_N2E, _route(NATIVE, address(usdc), amount)
        );

        assertEq(address(adapter).balance, 0, "I1: no MON parked in the adapter");
        assertEq(user.balance, refund, "unspent MON returned to the payer");
    }

    function test_swap_nativeValueMismatch_reverts() public {
        vm.deal(user, 2 ether);
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.NativeValueMismatch.selector);
        adapter.swap{value: 1 ether}(
            NATIVE, 2 ether, address(usdc), 0, DEADLINE, K_SINGLE_N2E, _route(NATIVE, address(usdc), 2 ether)
        );
    }

    /// @notice MON sent alongside an ERC20 swap would be unattributable.
    function test_swap_unexpectedValueOnErc20Path_reverts() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.NativeValueMismatch.selector);
        adapter.swap{value: 1 ether}(
            address(weth), 100e6, address(usdc), 0, DEADLINE, K_SINGLE_E2E, _route(address(weth), address(usdc), 100e6)
        );
    }

    function test_swap_residualInputSwept() public {
        uint256 amount = 500e6;
        uint256 preExisting = 100e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);
        weth.mint(address(adapter), preExisting);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth),
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(weth.balanceOf(address(adapter)), 0, "I1: adapter holds no input");
        assertEq(weth.balanceOf(user), preExisting, "residual swept to caller");
    }

    function test_swap_approvalClearedAfter() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth),
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(weth.allowance(address(adapter), address(diamond)), 0);
    }

    function test_swap_notVaultGated() public {
        address randomUser = address(0xCAFE);
        uint256 amount = 100e6;
        usdc.mint(address(diamond), amount);
        weth.mint(randomUser, amount);

        vm.startPrank(randomUser);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth),
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(randomUser), amount);
    }

    function test_swap_sameToken_reverts() public {
        weth.mint(user, 100e6);
        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(LiFiAdapter.SameToken.selector);
        adapter.swap(
            address(weth), 100e6, address(weth), 0, DEADLINE, K_SINGLE_E2E, _route(address(weth), address(weth), 100e6)
        );
        vm.stopPrank();
    }

    function test_swap_zeroAmount_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAmount.selector);
        adapter.swap(
            address(weth), 0, address(usdc), 0, DEADLINE, K_SINGLE_E2E, _route(address(weth), address(usdc), 0)
        );
    }

    /// @notice `address(0)` is still an error, not a second native marker.
    function test_swap_zeroInputToken_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAddress.selector);
        adapter.swap(
            address(0), 100e6, address(usdc), 0, DEADLINE, K_SINGLE_E2E, _route(address(0), address(usdc), 100e6)
        );
    }

    function test_swap_zeroOutputToken_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAddress.selector);
        adapter.swap(
            address(weth), 100e6, address(0), 0, DEADLINE, K_SINGLE_E2E, _route(address(weth), address(0), 100e6)
        );
    }

    function test_swap_expiredDeadline_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.swap(
            address(weth),
            100e6,
            address(usdc),
            0,
            block.timestamp - 1,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), 100e6)
        );
    }

    function test_swap_slippageExceeded_reverts() public {
        diamond.setRate(500_000);
        usdc.mint(address(diamond), 100e6);
        weth.mint(user, 100e6);

        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(abi.encodeWithSelector(MockLiFiDiamond.MockSlippage.selector, 50e6, 100e6));
        adapter.swap(
            address(weth),
            100e6,
            address(usdc),
            100e6,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), 100e6)
        );
        vm.stopPrank();
    }

    function test_swap_emitsSwapped() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        vm.expectEmit(true, true, true, true, address(adapter));
        emit LiFiAdapter.Swapped(user, address(weth), address(usdc), amount, amount);
        adapter.swap(
            address(weth),
            amount,
            address(usdc),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(weth), address(usdc), amount)
        );
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                          CONFIG / ADMIN / RESCUE
    //////////////////////////////////////////////////////////////*/

    function test_setApprovedDex_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setApprovedDex(address(0xDEAD), true);
    }

    function test_setApprovedSwapSelector_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setApprovedSwapSelector(bytes4(0x12345678), true);
    }

    function test_setApprovedSwapSelector_emits() public {
        vm.expectEmit(true, false, false, true, address(adapter));
        emit LiFiAdapter.SwapSelectorApprovalUpdated(bytes4(0x12345678), true);
        adapter.setApprovedSwapSelector(bytes4(0x12345678), true);
        assertTrue(adapter.isApprovedSwapSelector(bytes4(0x12345678)));
    }

    function test_setApprovedDex_emits() public {
        vm.expectEmit(true, false, false, true, address(adapter));
        emit LiFiAdapter.DexApprovalUpdated(address(0xD1), true);
        adapter.setApprovedDex(address(0xD1), true);
    }

    function test_setVault_emitsAndUpdates() public {
        address newVault = address(0xB0B);
        vm.expectEmit(true, true, false, false, address(adapter));
        emit LiFiAdapter.VaultUpdated(vault, newVault);
        adapter.setVault(newVault);
        assertEq(adapter.vault(), newVault);
    }

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
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.rescueToken(address(usdc), user, 100e6);
    }

    function test_rescueNative() public {
        vm.deal(address(diamond), 1 ether);
        vm.prank(address(diamond));
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertTrue(ok);

        adapter.rescueNative(address(0xCC), 1 ether);
        assertEq(address(0xCC).balance, 1 ether);
        assertEq(address(adapter).balance, 0);
    }

    function test_rescueNative_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.rescueNative(user, 0);
    }

    /// @notice Unattributed MON would otherwise be swept to whoever swaps next.
    function test_receive_fromNonDiamond_reverts() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertFalse(ok, "adapter is not a wallet");
    }

    function test_initialize_zeroVault_reverts() public {
        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        vm.expectRevert(LiFiAdapter.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, address(0))));
    }
}
