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

/// @title ShMonadAdapter fuzz tests — amounts, rates and the exit haircut
/// @dev Two legs and three assets means three ways to strand value. These check that
///      none of them happens for any amount, exchange rate or haircut.
contract ShMonadAdapterFuzzTest is Test {
    ShMonadAdapter internal adapter;
    LiFiAdapter internal swapper;
    MockUSDC internal usdc;
    MockLiFiDiamond internal diamond;
    MockShMonad internal shMonad;

    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal dex = address(0xDE);

    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;
    uint8 internal constant K_E2N = uint8(LibLiFi.SwapKind.SingleERC20ToNative);
    uint8 internal constant K_N2E = uint8(LibLiFi.SwapKind.SingleNativeToERC20);

    function setUp() public {
        usdc = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6);
        shMonad = new MockShMonad(0.5e18, 65);

        LiFiAdapter swapImpl = new LiFiAdapter(address(usdc), address(diamond));
        swapper = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(swapImpl), abi.encodeCall(LiFiAdapter.initialize, (address(this), vault)))
                ))
        );
        swapper.setApprovedDex(dex, true);
        swapper.setApprovedSwapSelector(DEX_SELECTOR, true);

        ShMonadAdapter impl = new ShMonadAdapter(address(usdc), address(shMonad), address(swapper));
        adapter = ShMonadAdapter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(ShMonadAdapter.initialize, (address(this), vault)))
                ))
        );

        vm.deal(address(diamond), type(uint128).max);
        usdc.mint(address(diamond), type(uint128).max);
        vm.deal(address(shMonad), type(uint128).max);
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

    function _stake(uint256 amount) internal returns (uint256) {
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), uint256(0), uint256(0), DEADLINE)
        );
        vm.stopPrank();
        return shMonad.balanceOf(user);
    }

    /// @notice I1 across all three assets, for any amount.
    function testFuzz_depositFor_strandsNothing(uint256 amount) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        uint256 shares = _stake(amount);

        assertGt(shares, 0, "receiver credited");
        assertEq(usdc.balanceOf(address(adapter)), 0, "no USDC stranded");
        assertEq(address(adapter).balance, 0, "no MON stranded");
        assertEq(shMonad.balanceOf(address(adapter)), 0, "no shMON stranded");
        assertEq(usdc.allowance(address(adapter), address(swapper)), 0, "I7: no residual approval");
    }

    /// @notice Any share rate, any haircut: the round trip must still settle cleanly
    ///         and must never return more than the haircut allows.
    function testFuzz_roundTrip_underAnyRateAndHaircut(uint256 amount, uint256 rate, uint256 haircutBps) public {
        amount = bound(amount, 1e6, 100_000e6);
        rate = bound(rate, 0.01e18, 10e18);
        haircutBps = bound(haircutBps, 0, 2_000); // 0% .. 20%

        shMonad.setShareRate(rate);
        shMonad.setExitHaircutBps(haircutBps);

        uint256 shares = _stake(amount);
        vm.assume(shares > 0);

        uint256 expectedMon = shMonad.previewRedeem(shares);
        vm.assume(expectedMon > 0);

        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(
            shares,
            user,
            user,
            abi.encode(K_N2E, _route(NATIVE, address(usdc), expectedMon), expectedMon, uint256(0), DEADLINE)
        );

        assertEq(usdcOut, expectedMon, "1:1 diamond, so USDC out tracks the MON paid out");
        assertLe(usdcOut, amount, "a round trip can never gain: the haircut is one-way");
        assertEq(address(adapter).balance, 0, "I1");
        assertEq(usdc.balanceOf(address(adapter)), 0, "I1");
        assertEq(shMonad.balanceOf(address(adapter)), 0, "I1");
    }

    /// @notice `previewRedeemMon` is the honest quote, for every haircut. Sizing a
    ///         minimum off it must always pass; sizing off the raw rate must fail
    ///         whenever a haircut exists.
    function testFuzz_previewRedeemMon_isTheSafeQuote(uint256 amount, uint256 haircutBps) public {
        amount = bound(amount, 1e6, 100_000e6);
        haircutBps = bound(haircutBps, 1, 2_000);
        shMonad.setExitHaircutBps(haircutBps);

        uint256 shares = _stake(amount);
        vm.assume(shares > 0);

        uint256 honest = adapter.previewRedeemMon(shares);
        uint256 raw = shMonad.convertToAssets(shares);
        vm.assume(honest > 0 && raw > honest);

        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        // Sizing off convertToAssets ignores the haircut and must be refused.
        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.SlippageExceeded.selector, honest, raw));
        adapter.redeemFor(
            shares, user, user, abi.encode(K_N2E, _route(NATIVE, address(usdc), honest), raw, uint256(0), DEADLINE)
        );

        // Sizing off previewRedeemMon is exact and must pass.
        vm.prank(vault);
        adapter.redeemFor(
            shares, user, user, abi.encode(K_N2E, _route(NATIVE, address(usdc), honest), honest, uint256(0), DEADLINE)
        );
    }

    /// @notice Capacity guard boundary: accept at the cap, reject above it.
    function testFuzz_capacityGuard(uint256 amount, uint256 cap) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        cap = bound(cap, 1, 2_000_000e6);
        shMonad.setMaxDeposit(cap);

        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        bytes memory data = abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), uint256(0), uint256(0), DEADLINE);

        // The diamond is 1:1 on the raw integer, so MON out equals the USDC in.
        if (amount > cap) {
            vm.expectRevert(abi.encodeWithSelector(ShMonadAdapter.ProtocolAtCapacity.selector, amount, cap));
            adapter.depositFor(amount, user, data);
        } else {
            adapter.depositFor(amount, user, data);
            assertGt(shMonad.balanceOf(user), 0);
        }
        vm.stopPrank();
    }
}
