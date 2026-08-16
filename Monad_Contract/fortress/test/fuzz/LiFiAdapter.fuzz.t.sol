// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";

/// @title LiFiAdapter fuzz tests — amount, slippage and residual boundaries
/// @dev Rebuilt for GenericSwapFacetV3 (DECISIONS.md D0-5). The properties are the
///      ones that must hold for every amount, not just the ones the unit tests pick:
///      the protocol's amount always overrides the quote's (I6), the adapter never
///      keeps a balance (I1), and the measured delta — not the diamond's word for it
///      — decides whether a swap passed its minimum (I8).
contract LiFiAdapterFuzzTest is Test {
    LiFiAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal diamond;

    address internal caller = address(0xBA); // the vault
    address internal receiver = address(0xA1);
    address internal dex = address(0xDE);

    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    address internal constant NATIVE = MonadAddresses.NATIVE;
    uint256 internal constant DEADLINE = type(uint256).max;

    uint8 internal constant K_SINGLE_E2E = uint8(LibLiFi.SwapKind.SingleERC20ToERC20);
    uint8 internal constant K_SINGLE_E2N = uint8(LibLiFi.SwapKind.SingleERC20ToNative);
    uint8 internal constant K_SINGLE_N2E = uint8(LibLiFi.SwapKind.SingleNativeToERC20);

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6); // 1:1

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (address(this), caller)));
        adapter = LiFiAdapter(payable(address(proxy)));

        adapter.setApprovedDex(dex, true);
        adapter.setApprovedSwapSelector(DEX_SELECTOR, true);
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
                                depositFor
    //////////////////////////////////////////////////////////////*/

    /// @notice I6 — leg 0's amount is always the vault's, never the quote's.
    function testFuzz_depositFor_amountOverride(uint256 vaultAmount, uint256 quotedAmount) public {
        vaultAmount = bound(vaultAmount, 1, 1_000_000_000e6);
        quotedAmount = bound(quotedAmount, 1, 1_000_000_000e6);

        weth.mint(address(diamond), vaultAmount);
        usdc.mint(caller, vaultAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), vaultAmount);
        adapter.depositFor(
            vaultAmount,
            receiver,
            abi.encode(
                K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), quotedAmount), uint256(0), DEADLINE
            )
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(diamond)), vaultAmount, "diamond pulled the vault amount");
        assertEq(weth.balanceOf(receiver), vaultAmount, "receiver got output for the vault amount");
    }

    function testFuzz_depositFor_slippage(uint256 amount, uint256 rate) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        rate = bound(rate, 500_000, 2_000_000); // 0.5x .. 2x

        diamond.setRate(rate);
        uint256 expectedOut = (amount * rate) / 1e6;
        uint256 minOut = (amount * 900_000) / 1e6; // 90% of input

        weth.mint(address(diamond), expectedOut);
        usdc.mint(caller, amount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), amount);
        bytes memory data =
            abi.encode(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), minOut, DEADLINE);

        if (expectedOut < minOut) {
            vm.expectRevert(abi.encodeWithSelector(MockLiFiDiamond.MockSlippage.selector, expectedOut, minOut));
        }
        adapter.depositFor(amount, receiver, data);
        vm.stopPrank();

        if (expectedOut >= minOut) {
            assertEq(weth.balanceOf(receiver), expectedOut);
        }
    }

    /// @notice The adapter's own delta check must reject an under-delivery even when
    ///         the diamond's internal minimum does not fire.
    function testFuzz_depositFor_deltaCheckIndependentOfDiamond(uint256 amount, uint256 rate) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        rate = bound(rate, 1, 999_999); // strictly under 1:1

        diamond.setRate(rate);
        diamond.setIgnoreMinAmount(true);
        uint256 expectedOut = (amount * rate) / 1e6;
        uint256 minOut = amount; // demand at least 1:1

        weth.mint(address(diamond), expectedOut);
        usdc.mint(caller, amount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), amount);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.SlippageExceeded.selector, expectedOut, minOut));
        adapter.depositFor(
            amount,
            receiver,
            abi.encode(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), minOut, DEADLINE)
        );
        vm.stopPrank();
    }

    /// @notice Requirement 10 — output-token dust already sitting on the adapter is
    ///         never counted as swap proceeds, for any amount.
    function testFuzz_depositFor_deltaExcludesDust(uint256 amount, uint256 dust) public {
        amount = bound(amount, 1e6, 1_000_000e6);
        dust = bound(dust, 1, 1_000_000e6);

        weth.mint(address(diamond), amount);
        weth.mint(address(adapter), dust);
        usdc.mint(caller, amount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(
            amount,
            receiver,
            abi.encode(K_SINGLE_E2E, address(weth), _route(address(usdc), address(weth), amount), uint256(0), DEADLINE)
        );
        vm.stopPrank();

        assertEq(weth.balanceOf(receiver), amount, "receiver got exactly the swap output");
        assertEq(weth.balanceOf(address(adapter)), dust, "dust neither paid out nor consumed");
    }

    /*//////////////////////////////////////////////////////////////
                                  swap()
    //////////////////////////////////////////////////////////////*/

    function testFuzz_swap_amountOverride(uint256 userAmount, uint256 quotedAmount) public {
        userAmount = bound(userAmount, 1, 1_000_000_000e6);
        quotedAmount = bound(quotedAmount, 1, 1_000_000_000e6);

        weth.mint(address(diamond), userAmount);
        usdc.mint(caller, userAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), userAmount);
        adapter.swap(
            address(usdc),
            userAmount,
            address(weth),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(usdc), address(weth), quotedAmount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(diamond)), userAmount, "diamond got the caller's amount");
        assertEq(weth.balanceOf(caller), userAmount, "caller got the output");
    }

    function testFuzz_swap_slippage(uint256 inputAmount, uint256 rate) public {
        inputAmount = bound(inputAmount, 1e6, 1_000_000e6);
        rate = bound(rate, 500_000, 2_000_000);

        diamond.setRate(rate);
        uint256 expectedOut = (inputAmount * rate) / 1e6;
        uint256 minOut = (inputAmount * 900_000) / 1e6;

        weth.mint(address(diamond), expectedOut);
        usdc.mint(caller, inputAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), inputAmount);

        if (expectedOut < minOut) {
            vm.expectRevert(abi.encodeWithSelector(MockLiFiDiamond.MockSlippage.selector, expectedOut, minOut));
        }
        adapter.swap(
            address(usdc),
            inputAmount,
            address(weth),
            minOut,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(usdc), address(weth), inputAmount)
        );
        vm.stopPrank();

        if (expectedOut >= minOut) {
            assertEq(weth.balanceOf(caller), expectedOut);
        }
    }

    /// @notice I1 — the adapter is stateless for every amount, on both sides.
    function testFuzz_swap_noStuckTokens(uint256 inputAmount) public {
        inputAmount = bound(inputAmount, 1, 1_000_000_000e6);

        weth.mint(address(diamond), inputAmount);
        usdc.mint(caller, inputAmount);

        vm.startPrank(caller);
        usdc.approve(address(adapter), inputAmount);
        adapter.swap(
            address(usdc),
            inputAmount,
            address(weth),
            0,
            DEADLINE,
            K_SINGLE_E2E,
            _route(address(usdc), address(weth), inputAmount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(adapter)), 0, "no stuck input");
        assertEq(weth.balanceOf(address(adapter)), 0, "no stuck output");
        assertEq(usdc.allowance(address(adapter), address(diamond)), 0, "I7: no residual approval");
    }

    /*//////////////////////////////////////////////////////////////
                              NATIVE LEGS
    //////////////////////////////////////////////////////////////*/

    /// @notice I1 across the native boundary: MON out leaves nothing behind.
    function testFuzz_swap_erc20ToNative_noStuckValue(uint256 inputAmount) public {
        inputAmount = bound(inputAmount, 1, 1_000e18);

        vm.deal(address(diamond), inputAmount);
        usdc.mint(caller, inputAmount);
        uint256 callerBalanceBefore = caller.balance;

        vm.startPrank(caller);
        usdc.approve(address(adapter), inputAmount);
        adapter.swap(
            address(usdc), inputAmount, NATIVE, 0, DEADLINE, K_SINGLE_E2N, _route(address(usdc), NATIVE, inputAmount)
        );
        vm.stopPrank();

        assertEq(caller.balance - callerBalanceBefore, inputAmount, "caller received MON");
        assertEq(address(adapter).balance, 0, "no MON parked in the adapter");
    }

    /// @notice Any unfilled share of a native input returns to the payer, exactly.
    function testFuzz_swap_nativeToErc20_refundReturned(uint256 inputAmount, uint256 refundBps) public {
        inputAmount = bound(inputAmount, 1e6, 1_000e18);
        refundBps = bound(refundBps, 0, 10_000);

        diamond.setNativeRefundBps(refundBps);
        usdc.mint(address(diamond), inputAmount);
        vm.deal(caller, inputAmount);

        vm.prank(caller);
        adapter.swap{value: inputAmount}(
            NATIVE, inputAmount, address(usdc), 0, DEADLINE, K_SINGLE_N2E, _route(NATIVE, address(usdc), inputAmount)
        );

        assertEq(caller.balance, (inputAmount * refundBps) / 10_000, "refund returned in full");
        assertEq(address(adapter).balance, 0, "I1");
        assertEq(usdc.balanceOf(caller), inputAmount, "output delivered");
    }
}
