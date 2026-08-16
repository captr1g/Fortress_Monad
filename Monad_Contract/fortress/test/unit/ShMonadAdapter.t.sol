// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/ShMonadAdapter.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";
import "../mocks/MockShMonad.sol";

/// @title ShMonadAdapter unit tests
///
/// @dev The swap leg runs through the **real** `LiFiAdapter`, not a stub. That is
///      the point of the composition: if `LiFiAdapter`'s allowlists, route checks or
///      native handling regress, these tests fail too. A stubbed swapper would test
///      the wiring and nothing else.
contract ShMonadAdapterTest is Test {
    ShMonadAdapter internal adapter;
    LiFiAdapter internal swapper;
    MockUSDC internal usdc;
    MockLiFiDiamond internal diamond;
    MockShMonad internal shMonad;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal dex = address(0xDE);

    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;

    uint8 internal constant K_E2N = uint8(LibLiFi.SwapKind.SingleERC20ToNative);
    uint8 internal constant K_N2E = uint8(LibLiFi.SwapKind.SingleNativeToERC20);
    uint8 internal constant K_E2E = uint8(LibLiFi.SwapKind.SingleERC20ToERC20);

    /// @dev 0.5 shMON per MON, and a 0.65% exit haircut — close to the live 0.645%.
    uint256 internal constant SHARE_RATE = 0.5e18;
    uint256 internal constant HAIRCUT_BPS = 65;

    function setUp() public {
        usdc = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6); // 1:1
        shMonad = new MockShMonad(SHARE_RATE, HAIRCUT_BPS);

        LiFiAdapter swapImpl = new LiFiAdapter(address(usdc), address(diamond));
        swapper = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(swapImpl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)))
                ))
        );
        swapper.setApprovedDex(dex, true);
        swapper.setApprovedSwapSelector(DEX_SELECTOR, true);

        ShMonadAdapter impl = new ShMonadAdapter(address(usdc), address(shMonad), address(swapper));
        adapter = ShMonadAdapter(
            payable(address(new ERC1967Proxy(address(impl), abi.encodeCall(ShMonadAdapter.initialize, (owner, vault)))))
        );

        // The diamond must hold both sides to simulate either direction.
        vm.deal(address(diamond), 10_000 ether);
        usdc.mint(address(diamond), 10_000_000e6);
        vm.deal(address(shMonad), 10_000 ether);
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _route(address from, address to, uint256 amount) internal view returns (LibSwap.SwapData[] memory r) {
        r = new LibSwap.SwapData[](1);
        r[0] = LibSwap.SwapData({
            callTo: dex,
            approveTo: dex,
            sendingAssetId: from,
            receivingAssetId: to,
            fromAmount: amount,
            callData: abi.encodePacked(DEX_SELECTOR),
            requiresDeposit: true
        });
    }

    function _depositData(uint256 amount, uint256 minMon, uint256 minShares) internal view returns (bytes memory) {
        return abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), minMon, minShares, DEADLINE);
    }

    function _redeemData(uint256 monAmount, uint256 minMon, uint256 minUsdc) internal view returns (bytes memory) {
        return abi.encode(K_N2E, _route(NATIVE, address(usdc), monAmount), minMon, minUsdc, DEADLINE);
    }

    /// @dev The mock diamond swaps 1:1 on the raw integer, so 1e6 USDC in yields
    ///      1e6 wei of MON out. Amounts are chosen so that stays legible.
    function _stake(uint256 usdcAmount, address receiver) internal returns (uint256) {
        usdc.mint(vault, usdcAmount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), usdcAmount);
        adapter.depositFor(usdcAmount, receiver, _depositData(usdcAmount, 0, 0));
        vm.stopPrank();
        return shMonad.balanceOf(receiver);
    }

    /*//////////////////////////////////////////////////////////////
                                 WIRING
    //////////////////////////////////////////////////////////////*/

    /// @notice The adapter's entire premise is that shMONAD is native-denominated.
    function test_constructor_rejectsNonNativeAsset() public {
        MockUSDC notNative = new MockUSDC();
        // A vault whose asset() is an ERC-20 belongs on the isERC4626 fast path.
        vm.expectRevert();
        new ShMonadAdapter(address(usdc), address(notNative), address(swapper));
    }

    function test_constructor_rejectsZeroAddress() public {
        vm.expectRevert(ShMonadAdapter.ZeroAddress.selector);
        new ShMonadAdapter(address(0), address(shMonad), address(swapper));
    }

    function test_wiring() public view {
        assertEq(address(adapter.usdc()), address(usdc));
        assertEq(address(adapter.shMonad()), address(shMonad));
        assertEq(address(adapter.swapper()), address(swapper));
        assertEq(adapter.NATIVE(), NATIVE);
    }

    /*//////////////////////////////////////////////////////////////
                          depositFor — HAPPY PATH
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_stakesToReceiver() public {
        uint256 amount = 1000e6;
        uint256 shares = _stake(amount, user);

        // 1000e6 USDC -> 1000e6 wei MON -> * 0.5 share rate
        assertEq(shares, (amount * SHARE_RATE) / 1e18, "shMON minted to the receiver");
        assertEq(shMonad.balanceOf(address(adapter)), 0, "I1: no shares held");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1: no USDC held");
        assertEq(address(adapter).balance, 0, "I1: no MON held");
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_clearsSwapperApproval() public {
        _stake(1000e6, user);
        assertEq(usdc.allowance(address(adapter), address(swapper)), 0, "I7");
    }

    function test_depositFor_emitsStaked() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);

        vm.expectEmit(true, true, false, true, address(adapter));
        emit ShMonadAdapter.Staked(vault, user, amount, amount, (amount * SHARE_RATE) / 1e18);
        adapter.depositFor(amount, user, _depositData(amount, 0, 0));
        vm.stopPrank();
    }

    /// @notice I6 — the vault's amount drives the swap, not the quoted route.
    function test_depositFor_overridesRouteAmount() public {
        uint256 amount = 500e6;
        usdc.mint(vault, amount);
        // Delta, not absolute: the diamond is pre-funded in setUp so it can pay out
        // either side of a swap.
        uint256 diamondBefore = usdc.balanceOf(address(diamond));

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, 9999e6), uint256(0), uint256(0), DEADLINE)
        );
        vm.stopPrank();

        assertEq(
            usdc.balanceOf(address(diamond)) - diamondBefore, amount, "diamond pulled the vault amount, not 9999e6"
        );
    }

    /*//////////////////////////////////////////////////////////////
                          depositFor — REJECTIONS
    //////////////////////////////////////////////////////////////*/

    function test_depositFor_noData_reverts() public {
        vm.expectRevert(ShMonadAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_depositFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(ShMonadAdapter.OnlyVault.selector);
        adapter.depositFor(1000e6, user, _depositData(1000e6, 0, 0));
    }

    function test_depositFor_zeroAmount_reverts() public {
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.ZeroAmount.selector);
        adapter.depositFor(0, user, _depositData(0, 0, 0));
    }

    function test_depositFor_zeroReceiver_reverts() public {
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.ZeroAddress.selector);
        adapter.depositFor(1000e6, address(0), _depositData(1000e6, 0, 0));
    }

    function test_depositFor_expiredDeadline_reverts() public {
        bytes memory data =
            abi.encode(K_E2N, _route(address(usdc), NATIVE, 100e6), uint256(0), uint256(0), block.timestamp - 1);
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.DeadlineExpired.selector);
        adapter.depositFor(100e6, user, data);
    }

    /// @notice shMONAD only takes MON, so a swap that does not end in MON is invalid.
    function test_depositFor_nonNativeOutKind_reverts() public {
        bytes memory data =
            abi.encode(K_E2E, _route(address(usdc), address(usdc), 100e6), uint256(0), uint256(0), DEADLINE);
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.KindMismatch.selector);
        adapter.depositFor(100e6, user, data);
    }

    function test_depositFor_nativeInKind_reverts() public {
        bytes memory data = abi.encode(K_N2E, _route(NATIVE, address(usdc), 100e6), uint256(0), uint256(0), DEADLINE);
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.KindMismatch.selector);
        adapter.depositFor(100e6, user, data);
    }

    /// @notice The MON leg carries its own floor, separate from the share floor.
    function test_depositFor_monSlippage_reverts() public {
        diamond.setRate(500_000); // 0.5x — 1000e6 USDC yields 500e6 wei MON
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        // The swapper's own minimum fires first; either way the deposit is refused.
        vm.expectRevert();
        adapter.depositFor(amount, user, _depositData(amount, 900e6, 0));
        vm.stopPrank();
    }

    /// @notice A bad exchange rate must be caught even when the swap leg was fine.
    function test_depositFor_shareSlippage_reverts() public {
        shMonad.setShareRate(0.1e18); // far worse than expected
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);

        uint256 expectedAtHalf = (amount * SHARE_RATE) / 1e18;
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        vm.expectRevert(
            abi.encodeWithSelector(ShMonadAdapter.SlippageExceeded.selector, (amount * 0.1e18) / 1e18, expectedAtHalf)
        );
        adapter.depositFor(amount, user, _depositData(amount, 0, expectedAtHalf));
        vm.stopPrank();
    }

    function test_depositFor_overCapacity_reverts() public {
        shMonad.setMaxDeposit(100e6);
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.ProtocolAtCapacity.selector, amount, 100e6));
        adapter.depositFor(amount, user, _depositData(amount, 0, 0));
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                                redeemFor
    //////////////////////////////////////////////////////////////*/

    function test_redeemFor_returnsUsdcToReceiver() public {
        uint256 amount = 1000e6;
        uint256 shares = _stake(amount, user);

        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 expectedMon = shMonad.previewRedeem(shares);
        address receiver = address(0xBB);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(shares, receiver, user, _redeemData(expectedMon, 0, 0));

        assertEq(usdcOut, expectedMon, "1:1 diamond, so USDC out tracks MON out");
        assertEq(usdc.balanceOf(receiver), usdcOut, "I2");
        assertEq(shMonad.balanceOf(user), 0, "position fully burned");
        assertEq(address(adapter).balance, 0, "I1: no MON stranded");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
        assertEq(shMonad.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice The round trip loses the exit haircut, and that is expected, not a bug.
    function test_redeemFor_haircutIsRealAndVisible() public {
        uint256 amount = 1000e6;
        uint256 shares = _stake(amount, user);

        uint256 raw = shMonad.convertToAssets(shares);
        uint256 actual = shMonad.previewRedeem(shares);
        assertLt(actual, raw, "previewRedeem sits below convertToAssets");
        assertEq(raw - actual, (raw * HAIRCUT_BPS) / 10_000, "the gap is the haircut");

        // The adapter surfaces the honest number, so callers can size a minimum.
        assertEq(adapter.previewRedeemMon(shares), actual, "previewRedeemMon quotes the haircut number");
    }

    function test_redeemFor_emitsUnstaked() public {
        uint256 shares = _stake(1000e6, user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 mon = shMonad.previewRedeem(shares);
        vm.expectEmit(true, true, false, true, address(adapter));
        emit ShMonadAdapter.Unstaked(user, user, shares, mon, mon);

        vm.prank(vault);
        adapter.redeemFor(shares, user, user, _redeemData(mon, 0, 0));
    }

    /// @notice Sizing `minMonOut` off `convertToAssets` — the raw rate — must fail,
    ///         because it ignores the haircut. This is the caller mistake the
    ///         interface docs warn about, made executable.
    function test_redeemFor_minSizedOffConvertToAssets_reverts() public {
        uint256 shares = _stake(1000e6, user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 raw = shMonad.convertToAssets(shares);
        uint256 actual = shMonad.previewRedeem(shares);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.SlippageExceeded.selector, actual, raw));
        adapter.redeemFor(shares, user, user, _redeemData(actual, raw, 0));
    }

    function test_redeemFor_usdcSlippage_reverts() public {
        uint256 shares = _stake(1000e6, user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 mon = shMonad.previewRedeem(shares);
        vm.prank(vault);
        vm.expectRevert(); // the swapper's own minimum fires
        adapter.redeemFor(shares, user, user, _redeemData(mon, 0, mon * 2));
    }

    function test_redeemFor_nonNativeInKind_reverts() public {
        uint256 shares = _stake(1000e6, user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        bytes memory data = abi.encode(K_E2N, _route(address(usdc), NATIVE, 100e6), uint256(0), uint256(0), DEADLINE);
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.KindMismatch.selector);
        adapter.redeemFor(shares, user, user, data);
    }

    function test_redeemFor_noData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_notVault_reverts() public {
        vm.prank(user);
        vm.expectRevert(ShMonadAdapter.OnlyVault.selector);
        adapter.redeemFor(1000e6, user, user, _redeemData(0, 0, 0));
    }

    function test_redeemFor_zeroShares_reverts() public {
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user, _redeemData(0, 0, 0));
    }

    function test_redeemFor_expiredDeadline_reverts() public {
        bytes memory data =
            abi.encode(K_N2E, _route(NATIVE, address(usdc), 100e6), uint256(0), uint256(0), block.timestamp - 1);
        vm.prank(vault);
        vm.expectRevert(ShMonadAdapter.DeadlineExpired.selector);
        adapter.redeemFor(100e6, user, user, data);
    }

    /// @notice The rebalance shape: receiver is the vault, owner is the user.
    function test_redeemFor_receiverDiffersFromOwner() public {
        uint256 shares = _stake(1000e6, user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 mon = shMonad.previewRedeem(shares);
        vm.prank(vault);
        adapter.redeemFor(shares, vault, user, _redeemData(mon, 0, 0));

        assertEq(usdc.balanceOf(vault), mon, "USDC parked with the vault for the next leg");
    }

    /*//////////////////////////////////////////////////////////////
                          NATIVE CUSTODY HYGIENE
    //////////////////////////////////////////////////////////////*/

    /// @notice Unattributed MON would be indistinguishable from a leg's proceeds.
    function test_receive_fromStranger_reverts() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertFalse(ok, "adapter is not a wallet");
    }

    function test_receive_fromShMonad_accepted() public {
        vm.deal(address(shMonad), 1 ether);
        vm.prank(address(shMonad));
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(adapter).balance, 1 ether);
    }

    function test_receive_fromSwapper_accepted() public {
        vm.deal(address(swapper), 1 ether);
        vm.prank(address(swapper));
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertTrue(ok);
    }

    /// @notice MON left over from a partial leg goes back to whoever supplied it.
    function test_sweep_returnsStrandedMonOnDeposit() public {
        vm.deal(address(shMonad), 1 ether);
        vm.prank(address(shMonad));
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertTrue(ok);

        uint256 vaultBefore = vault.balance;
        _stake(1000e6, user);

        assertEq(address(adapter).balance, 0, "I1: swept clean");
        assertEq(vault.balance, vaultBefore + 1 ether, "stranded MON returned to the vault");
    }

    /*//////////////////////////////////////////////////////////////
                            ADMIN / RESCUE
    //////////////////////////////////////////////////////////////*/

    function test_setVault_emitsAndUpdates() public {
        address newVault = address(0xB0B);
        vm.expectEmit(true, true, false, false, address(adapter));
        emit ShMonadAdapter.VaultUpdated(vault, newVault);
        adapter.setVault(newVault);
        assertEq(adapter.vault(), newVault);
    }

    function test_setVault_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setVault(address(0xB0B));
    }

    function test_rescueToken() public {
        usdc.mint(address(adapter), 100e6);
        adapter.rescueToken(address(usdc), address(0xCC), 100e6);
        assertEq(usdc.balanceOf(address(0xCC)), 100e6);
    }

    function test_rescueNative() public {
        vm.deal(address(shMonad), 1 ether);
        vm.prank(address(shMonad));
        (bool ok,) = address(adapter).call{value: 1 ether}("");
        assertTrue(ok);

        adapter.rescueNative(address(0xCC), 1 ether);
        assertEq(address(0xCC).balance, 1 ether);
    }

    function test_rescueNative_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.rescueNative(user, 0);
    }

    function test_availableCapacity() public {
        assertEq(adapter.availableCapacity(), type(uint128).max);
        shMonad.setMaxDeposit(123);
        assertEq(adapter.availableCapacity(), 123);
    }
}
