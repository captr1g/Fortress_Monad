// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/adapters/ShMonadAdapter.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/IShMonad.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../helpers/MonadFork.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockLiFiDiamond.sol";

/// @title ShMonadAdapter fork tests — the real shMONAD, at the pinned block
///
/// @notice The shMONAD half of every path here is the LIVE contract: the payable
///         deposit, the real exchange rate, the real exit haircut, the real
///         settlement. Only the LI.FI swap leg is simulated, because the selector
///         allowlist ships empty by design (DECISIONS.md D4-3) and there is no
///         verified chain-143 route to allowlist yet. That boundary is deliberate
///         and is stated per test rather than blurred.
///
/// @dev Excluded from the default CI run (`--no-match-path "test/fork/*"`); needs
///      `MONAD_RPC_URL`.
contract ShMonadAdapterForkTest is Test, MonadFork {
    ShMonadAdapter internal adapter;
    LiFiAdapter internal swapper;
    MockERC20 internal usdc;
    MockLiFiDiamond internal diamond;
    IShMonad internal shMonad;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal dex = address(0xDE);

    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;
    uint8 internal constant K_E2N = uint8(LibLiFi.SwapKind.SingleERC20ToNative);
    uint8 internal constant K_N2E = uint8(LibLiFi.SwapKind.SingleNativeToERC20);

    function setUp() public {
        _forkMonad();
        shMonad = IShMonad(MonadAddresses.SHMONAD);

        // A local token and diamond stand in for the swap leg only. shMONAD is real.
        //
        // The stand-in is 18-decimal on purpose: the mock diamond applies one rate
        // in both directions, so a 6-decimal token would need a 1e12 up-scale into
        // MON and a 1e-12 down-scale back out, and the second is not expressible in
        // integer arithmetic. Matching decimals keeps both legs a clean 1:1 and
        // leaves the haircut as the only thing moving the numbers. Decimals are
        // irrelevant to the adapter, which never interprets them.
        usdc = new MockERC20("Stand-in USDC", "sUSDC", 18);
        diamond = new MockLiFiDiamond(1e6); // 1:1 in both directions

        LiFiAdapter swapImpl = new LiFiAdapter(address(usdc), address(diamond));
        swapper = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(swapImpl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)))
                ))
        );
        swapper.setApprovedDex(dex, true);
        swapper.setApprovedSwapSelector(DEX_SELECTOR, true);

        ShMonadAdapter impl = new ShMonadAdapter(address(usdc), MonadAddresses.SHMONAD, address(swapper));
        adapter = ShMonadAdapter(
            payable(address(new ERC1967Proxy(address(impl), abi.encodeCall(ShMonadAdapter.initialize, (owner, vault)))))
        );

        vm.deal(address(diamond), 100_000 ether);
        usdc.mint(address(diamond), 1_000_000e18);
    }

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

    /*//////////////////////////////////////////////////////////////
                        LIVE shMONAD PROPERTIES
    //////////////////////////////////////////////////////////////*/

    /// @notice The premise: shMONAD is native-denominated, so the ERC-4626 fast path
    ///         cannot drive it and an adapter is required.
    function test_fork_assetIsNativeSentinel() public view {
        assertEq(shMonad.asset(), MonadAddresses.NATIVE, "asset() must be the 0xEeee sentinel");
    }

    /// @notice A vault whose asset is not the sentinel must not be wired to this
    ///         adapter — the constructor proves it rather than assuming it.
    function test_fork_constructorRejectsNonNativeVault() public {
        vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.UnexpectedAsset.selector, MonadAddresses.USDC));
        new ShMonadAdapter(address(usdc), MonadAddresses.CURVANCE_CUSDC, address(swapper));
    }

    /// @notice `deposit` takes its MON as `msg.value`. Without value the live
    ///         contract reverts — this is exactly what breaks `IERC20.transferFrom`
    ///         on the fast path.
    function test_fork_depositRequiresValue() public {
        vm.deal(user, 10 ether);
        vm.prank(user);
        (bool ok,) =
            MonadAddresses.SHMONAD.call(abi.encodeWithSignature("deposit(uint256,address)", uint256(1 ether), user));
        assertFalse(ok, "deposit without value must revert on the live contract");

        vm.prank(user);
        (bool okWithValue,) = MonadAddresses.SHMONAD.call{value: 1 ether}(
            abi.encodeWithSignature("deposit(uint256,address)", uint256(1 ether), user)
        );
        assertTrue(okWithValue, "deposit with value succeeds");
        assertGt(shMonad.balanceOf(user), 0);
    }

    /// @notice The exit haircut is real and must be quoted from `previewRedeem`.
    ///         Measured at the pinned block: ~0.645%.
    function test_fork_exitHaircutIsRealNotRounding() public {
        vm.deal(user, 100 ether);
        vm.prank(user);
        shMonad.deposit{value: 10 ether}(10 ether, user);

        uint256 shares = shMonad.balanceOf(user);
        uint256 raw = shMonad.convertToAssets(shares);
        uint256 honest = shMonad.previewRedeem(shares);

        assertLt(honest, raw, "previewRedeem sits below convertToAssets");
        uint256 haircutBps = ((raw - honest) * 10_000) / raw;
        emit log_named_uint("exit haircut, bps", haircutBps);
        assertGt(haircutBps, 10, "far beyond a rounding artefact");

        // And previewRedeem is the number that actually materialises.
        uint256 before = user.balance;
        vm.prank(user);
        uint256 assets = shMonad.redeem(shares, user, user);
        assertEq(assets, honest, "previewRedeem matches the realised amount exactly");
        assertEq(user.balance - before, honest, "and the MON actually arrives");
    }

    /// @notice Redemption settles in the same transaction — no unbonding queue.
    function test_fork_redeemIsImmediate() public {
        vm.deal(user, 100 ether);
        vm.startPrank(user);
        shMonad.deposit{value: 10 ether}(10 ether, user);
        uint256 shares = shMonad.balanceOf(user);
        uint256 assets = shMonad.redeem(shares, user, user);
        vm.stopPrank();

        assertGt(assets, 0, "settled immediately, no cooldown");
        assertEq(shMonad.balanceOf(user), 0);
    }

    function test_fork_hasOpenCapacity() public view {
        assertGt(adapter.availableCapacity(), 1_000_000 ether, "shMONAD is effectively uncapped");
    }

    /*//////////////////////////////////////////////////////////////
              FULL PATH — real shMONAD, simulated swap leg
    //////////////////////////////////////////////////////////////*/

    /// @notice Vault USDC in, real shMON out, real shMON back to USDC. Only the
    ///         LI.FI hop is simulated; the staking and unstaking are live.
    function test_fork_fullRoundTripThroughLiveShMonad() public {
        uint256 usdcIn = 100e18; // -> 100 MON at the stand-in 1:1 rate
        usdc.mint(vault, usdcIn);

        vm.startPrank(vault);
        usdc.approve(address(adapter), usdcIn);
        adapter.depositFor(
            usdcIn, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, usdcIn), uint256(0), uint256(0), DEADLINE)
        );
        vm.stopPrank();

        uint256 shares = shMonad.balanceOf(user);
        assertGt(shares, 0, "live shMON minted to the receiver");
        assertEq(address(adapter).balance, 0, "I1: no MON stranded");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1: no USDC stranded");
        assertEq(IERC20(MonadAddresses.SHMONAD).balanceOf(address(adapter)), 0, "I1: no shMON stranded");

        uint256 expectedMon = adapter.previewRedeemMon(shares);
        emit log_named_decimal_uint("stand-in USDC staked", usdcIn, 18);
        emit log_named_decimal_uint("shMON received", shares, 18);
        emit log_named_decimal_uint("MON on exit", expectedMon, 18);

        vm.prank(user);
        IERC20(MonadAddresses.SHMONAD).approve(address(adapter), shares);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(
            shares,
            user,
            user,
            abi.encode(K_N2E, _route(NATIVE, address(usdc), expectedMon), expectedMon, uint256(0), DEADLINE)
        );

        assertGt(usdcOut, 0, "USDC returned");
        assertLt(usdcOut, usdcIn, "the round trip loses the live exit haircut");
        emit log_named_decimal_uint("stand-in USDC returned", usdcOut, 18);

        assertEq(address(adapter).balance, 0, "I1");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
        assertEq(IERC20(MonadAddresses.SHMONAD).balanceOf(address(adapter)), 0, "I1");
        assertEq(shMonad.balanceOf(user), 0, "position fully exited");
    }

    /// @notice Sizing the exit minimum off the raw rate must fail against the live
    ///         haircut — the caller mistake the interface warns about.
    function test_fork_minSizedOffConvertToAssets_reverts() public {
        uint256 usdcIn = 100e18;
        usdc.mint(vault, usdcIn);
        vm.startPrank(vault);
        usdc.approve(address(adapter), usdcIn);
        adapter.depositFor(
            usdcIn, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, usdcIn), uint256(0), uint256(0), DEADLINE)
        );
        vm.stopPrank();

        uint256 shares = shMonad.balanceOf(user);
        uint256 raw = shMonad.convertToAssets(shares);
        uint256 honest = shMonad.previewRedeem(shares);

        vm.prank(user);
        IERC20(MonadAddresses.SHMONAD).approve(address(adapter), shares);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.SlippageExceeded.selector, honest, raw));
        adapter.redeemFor(
            shares, user, user, abi.encode(K_N2E, _route(NATIVE, address(usdc), honest), raw, uint256(0), DEADLINE)
        );
    }
}
