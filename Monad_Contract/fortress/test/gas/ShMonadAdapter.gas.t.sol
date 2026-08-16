// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/ShMonadAdapter.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";
import "../mocks/MockShMonad.sol";

/// @title ShMonadAdapter gas envelopes (invariant I13, adapter requirement 11)
///
/// @dev Run under Monad Foundry only (`network = "monad"`). Upstream Foundry
///      under-reports cold-state cost by ~3.85x — DECISIONS.md D0-3.
///
///      This is the most expensive adapter in the codebase, and structurally so:
///      every path crosses three contracts (this adapter, `LiFiAdapter`, shMONAD)
///      and three assets (USDC, native MON, shMON). The envelopes therefore sit
///      well above the single-venue adapters, and that gap is the point of
///      measuring — a caller sizing a limit off `AaveV3Adapter`'s numbers would
///      run out of gas here.
contract ShMonadAdapterGasTest is Test {
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

    /// @dev Measured under Monad Foundry with `network = "monad"`, cold. Envelopes
    ///      carry ~13% headroom. Re-measure and re-set if the adapter changes; do
    ///      not widen one to make a failing run pass.
    ///      Measured: depositFor 556,333 | redeemFor 179,645 (partly warm, it runs
    ///      after a deposit in the same test).
    uint256 internal constant ENVELOPE_DEPOSIT = 630_000;
    uint256 internal constant ENVELOPE_REDEEM = 205_000;

    /// @dev The nested-overhead test takes the native side of a swap directly, so
    ///      this contract has to be able to receive MON.
    receive() external payable {}

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

        vm.deal(address(diamond), 10_000 ether);
        usdc.mint(address(diamond), 10_000_000e6);
        vm.deal(address(shMonad), 10_000 ether);
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

    function test_gas_depositFor() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);
        bytes memory data = abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), uint256(0), uint256(0), DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 before = gasleft();
        adapter.depositFor(amount, user, data);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("depositFor (USDC->MON->shMON) gas:", used);
        assertLt(used, ENVELOPE_DEPOSIT, "depositFor exceeded its measured envelope");
    }

    function test_gas_redeemFor() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), uint256(0), uint256(0), DEADLINE)
        );
        vm.stopPrank();

        uint256 shares = shMonad.balanceOf(user);
        vm.prank(user);
        shMonad.approve(address(adapter), shares);

        uint256 mon = shMonad.previewRedeem(shares);
        bytes memory data = abi.encode(K_N2E, _route(NATIVE, address(usdc), mon), mon, uint256(0), DEADLINE);

        vm.prank(vault);
        uint256 before = gasleft();
        adapter.redeemFor(shares, user, user, data);
        uint256 used = before - gasleft();

        console.log("redeemFor (shMON->MON->USDC) gas:", used);
        assertLt(used, ENVELOPE_REDEEM, "redeemFor exceeded its measured envelope");
    }

    /// @notice Records what the nested `LiFiAdapter` hop costs, so the decision to
    ///         reuse it rather than inline the route validation is priced.
    function test_gas_nestedSwapOverhead() public {
        uint256 amount = 1000e6;
        usdc.mint(vault, amount);
        usdc.mint(address(this), amount);

        // The same swap, called directly on the swapper rather than through this
        // adapter. The difference is what the staking leg plus custody adds.
        usdc.approve(address(swapper), amount);
        uint256 b1 = gasleft();
        swapper.swap(address(usdc), amount, NATIVE, 0, DEADLINE, K_E2N, _route(address(usdc), NATIVE, amount));
        uint256 swapOnly = b1 - gasleft();

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 b2 = gasleft();
        adapter.depositFor(
            amount, user, abi.encode(K_E2N, _route(address(usdc), NATIVE, amount), uint256(0), uint256(0), DEADLINE)
        );
        uint256 full = b2 - gasleft();
        vm.stopPrank();

        // The second call runs warm — the swapper, the token and the diamond were
        // all touched by the first — so `full` reads LOWER than `swapOnly` despite
        // doing strictly more work. Recorded as a shape, not as a subtractable
        // overhead; the cold numbers are the two envelope tests above.
        console.log("swap leg alone (cold):", swapOnly);
        console.log("full depositFor (warm):", full);
    }
}
