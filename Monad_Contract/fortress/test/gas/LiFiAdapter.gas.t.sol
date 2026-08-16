// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";

/// @title LiFiAdapter gas envelopes (invariant I13, adapter requirement 11)
///
/// @notice Monad charges on `gas_limit`, not `gas_used`, so every entry point needs
///         a measured envelope a caller can actually set a limit from.
///
/// @dev **Run under Monad Foundry only.** Upstream Foundry under-reports cold-state
///      cost by ~3.85x (DECISIONS.md D0-3), and installing the Monad fork is not
///      sufficient on its own — `network = "monad"` in `foundry.toml` selects the
///      Monad opcode schedule, and without it cold SLOAD prices at Ethereum's 2,100
///      instead of Monad's 8,100 (`test/gas/ColdSloadPricing.t.sol`).
///
///          foundryup --network monad
///          forge test --match-path "test/gas/*" -vv
///
///      Numbers here are the MOCK diamond's cost, not a live route's: the mock
///      simulates the leg instead of executing `callData`, so a production swap
///      costs this plus whatever the real DEX leg costs. What these envelopes bound
///      is the part FORTRESS owns — validation, allowlist reads, approval churn,
///      the balance-delta snapshots and the payout — which is exactly the part a
///      regression would show up in.
///
///      The per-leg slope is the number that matters for multi-hop routes: each
///      extra leg costs two cold allowlist SLOADs (`callTo`, `approveTo`) plus the
///      selector lookup, and Monad prices those at ~8,100 each.
contract LiFiAdapterGasTest is Test {
    LiFiAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal diamond;

    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal dex = address(0xDE);

    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;

    /// @dev Envelopes, set from values measured under Monad Foundry with
    ///      `network = "monad"`. Each carries ~13% headroom over its measurement —
    ///      enough to absorb warm/cold variation across callers, tight enough that
    ///      a real regression trips it. Measured (all cold):
    ///
    ///        depositFor  single ERC20->ERC20    399,628
    ///        depositFor  multi(2) ERC20->ERC20  426,098
    ///        depositFor  single ERC20->Native   394,548
    ///        redeemFor   single ERC20->ERC20    391,593
    ///        swap        single ERC20->ERC20    384,130
    ///
    ///      Re-measure and re-set these if the adapter changes; do not widen one to
    ///      make a failing run pass.
    uint256 internal constant ENVELOPE_DEPOSIT_SINGLE = 452_000;
    uint256 internal constant ENVELOPE_DEPOSIT_MULTI_2 = 482_000;
    uint256 internal constant ENVELOPE_DEPOSIT_NATIVE_OUT = 446_000;
    uint256 internal constant ENVELOPE_REDEEM_SINGLE = 443_000;
    uint256 internal constant ENVELOPE_SWAP_SINGLE = 434_000;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6);

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        adapter = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (address(this), vault)))
                ))
        );
        adapter.setApprovedDex(dex, true);
        adapter.setApprovedSwapSelector(DEX_SELECTOR, true);
    }

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

    function _route2(address from, address mid, address to, uint256 amount)
        internal
        view
        returns (LibSwap.SwapData[] memory r)
    {
        r = new LibSwap.SwapData[](2);
        r[0] = _leg(from, mid, amount);
        r[1] = _leg(mid, to, amount);
    }

    /*//////////////////////////////////////////////////////////////
                                depositFor
    //////////////////////////////////////////////////////////////*/

    function test_gas_depositFor_singleERC20ToERC20() public {
        uint256 amount = 1000e6;
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        bytes memory data = abi.encode(
            uint8(LibLiFi.SwapKind.SingleERC20ToERC20),
            address(weth),
            _route(address(usdc), address(weth), amount),
            uint256(0),
            DEADLINE
        );

        uint256 before = gasleft();
        adapter.depositFor(amount, user, data);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("depositFor single ERC20->ERC20 gas:", used);
        assertLt(used, ENVELOPE_DEPOSIT_SINGLE, "depositFor(single) exceeded its measured envelope");
    }

    function test_gas_depositFor_multipleERC20ToERC20() public {
        uint256 amount = 1000e6;
        MockUSDC mid = new MockUSDC();
        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        bytes memory data = abi.encode(
            uint8(LibLiFi.SwapKind.MultipleERC20ToERC20),
            address(weth),
            _route2(address(usdc), address(mid), address(weth), amount),
            uint256(0),
            DEADLINE
        );

        uint256 before = gasleft();
        adapter.depositFor(amount, user, data);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("depositFor multi(2 legs) ERC20->ERC20 gas:", used);
        assertLt(used, ENVELOPE_DEPOSIT_MULTI_2, "depositFor(multi) exceeded its measured envelope");
    }

    /// @notice The shMONAD-shaped path (Phase 4 task 13): USDC in, native MON out.
    function test_gas_depositFor_singleERC20ToNative() public {
        uint256 amount = 1000e6;
        vm.deal(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        bytes memory data = abi.encode(
            uint8(LibLiFi.SwapKind.SingleERC20ToNative),
            NATIVE,
            _route(address(usdc), NATIVE, amount),
            uint256(0),
            DEADLINE
        );

        uint256 before = gasleft();
        adapter.depositFor(amount, user, data);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("depositFor single ERC20->Native gas:", used);
        assertLt(used, ENVELOPE_DEPOSIT_NATIVE_OUT, "depositFor(native out) exceeded its measured envelope");
    }

    /*//////////////////////////////////////////////////////////////
                                redeemFor
    //////////////////////////////////////////////////////////////*/

    function test_gas_redeemFor_singleERC20ToERC20() public {
        uint256 shares = 1000e6;
        usdc.mint(address(diamond), shares);
        weth.mint(user, shares);

        vm.prank(user);
        weth.approve(address(adapter), shares);

        bytes memory data = abi.encode(
            uint8(LibLiFi.SwapKind.SingleERC20ToERC20),
            address(weth),
            _route(address(weth), address(usdc), shares),
            uint256(0),
            DEADLINE
        );

        vm.prank(vault);
        uint256 before = gasleft();
        adapter.redeemFor(shares, user, user, data);
        uint256 used = before - gasleft();

        console.log("redeemFor single ERC20->ERC20 gas:", used);
        assertLt(used, ENVELOPE_REDEEM_SINGLE, "redeemFor(single) exceeded its measured envelope");
    }

    /*//////////////////////////////////////////////////////////////
                                  swap()
    //////////////////////////////////////////////////////////////*/

    function test_gas_swap_singleERC20ToERC20() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        LibSwap.SwapData[] memory route = _route(address(weth), address(usdc), amount);

        uint256 before = gasleft();
        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, uint8(LibLiFi.SwapKind.SingleERC20ToERC20), route
        );
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("swap single ERC20->ERC20 gas:", used);
        assertLt(used, ENVELOPE_SWAP_SINGLE, "swap(single) exceeded its measured envelope");
    }

    /*//////////////////////////////////////////////////////////////
                              PER-LEG SLOPE
    //////////////////////////////////////////////////////////////*/

    /// @notice Records the marginal cost of one extra route leg, so a caller can
    ///         size a limit for an n-hop route instead of guessing.
    ///
    /// @dev Both measurements run against a FRESH adapter, so both are cold. Timing
    ///      them back-to-back on one instance would warm the allowlist slots and the
    ///      token balances, and the second call measures ~124k against the first's
    ///      ~400k — a difference that is all warm/cold, not per-leg. Monad prices a
    ///      cold SLOAD at ~8,100 (four times Ethereum's), so on this chain that
    ///      distinction is the measurement.
    function test_gas_perLegSlope() public {
        uint256 amount = 1000e6;
        uint256 g1 = _measureColdDeposit(amount, false);
        uint256 g2 = _measureColdDeposit(amount, true);

        console.log("1-leg gas (cold):", g1);
        console.log("2-leg gas (cold):", g2);
        console.log("marginal per extra leg:", g2 - g1);

        assertGt(g2, g1, "an extra leg must cost more, not less");
    }

    /// @dev Deploys a fresh adapter and times one `depositFor` against it.
    function _measureColdDeposit(uint256 amount, bool twoLegs) internal returns (uint256 used) {
        MockUSDC out = new MockUSDC();
        MockUSDC mid = new MockUSDC();
        MockLiFiDiamond d = new MockLiFiDiamond(1e6);
        out.mint(address(d), amount);

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(d));
        LiFiAdapter a = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (address(this), vault)))
                ))
        );
        a.setApprovedDex(dex, true);
        a.setApprovedSwapSelector(DEX_SELECTOR, true);

        usdc.mint(vault, amount);

        bytes memory data = twoLegs
            ? abi.encode(
                uint8(LibLiFi.SwapKind.MultipleERC20ToERC20),
                address(out),
                _route2(address(usdc), address(mid), address(out), amount),
                uint256(0),
                DEADLINE
            )
            : abi.encode(
                uint8(LibLiFi.SwapKind.SingleERC20ToERC20),
                address(out),
                _route(address(usdc), address(out), amount),
                uint256(0),
                DEADLINE
            );

        vm.startPrank(vault);
        usdc.approve(address(a), amount);
        uint256 before = gasleft();
        a.depositFor(amount, user, data);
        used = before - gasleft();
        vm.stopPrank();
    }
}
