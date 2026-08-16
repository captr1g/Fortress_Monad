// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockFortProtocolEx.sol";
import "../mocks/MockLiFiDiamond.sol";
import "../../src/FortSwapRouter.sol";
import "../../src/interfaces/ILiFi.sol";

contract FortVaultSwapAndDepositFuzzTest is FortVaultTestBase {
    MockERC4626Vault internal erc4626;
    MockFortProtocol internal adapter;
    MockFortProtocolEx internal adapterEx;
    MockLiFiDiamond internal lifi;

    /// @dev A LI.FI leg targets the DEX, never the diamond.
    address internal dex = address(0xDE);
    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    MockUSDC internal weth;
    FortSwapRouter internal swapRouter;

    address internal user = address(0xA1);
    bytes32 internal key4626;
    bytes32 internal keyAdapter;
    bytes32 internal keyAdapterEx;

    function setUp() public override {
        super.setUp();

        erc4626 = new MockERC4626Vault(mockUsdc);
        adapter = new MockFortProtocol(address(mockUsdc));
        adapterEx = new MockFortProtocolEx(address(mockUsdc));
        weth = new MockUSDC();

        lifi = new MockLiFiDiamond(1e6); // 1:1
        mockUsdc.mint(address(lifi), type(uint128).max);

        vault.registerProtocol("ERC4626", address(erc4626), true);
        vault.registerProtocol("Adapter", address(adapter), false);
        vault.registerProtocol("AdapterEx", address(adapterEx), false);

        key4626 = keccak256(bytes("ERC4626"));
        keyAdapter = keccak256(bytes("Adapter"));
        keyAdapterEx = keccak256(bytes("AdapterEx"));

        // Deploy FortSwapRouter
        FortSwapRouter routerImpl = new FortSwapRouter(address(mockUsdc), address(lifi));
        ERC1967Proxy routerProxy = new ERC1967Proxy(
            address(routerImpl), abi.encodeCall(FortSwapRouter.initialize, (address(this), address(vault)))
        );
        swapRouter = FortSwapRouter(address(routerProxy));
        // I5 is two allowlists: the leg's target AND its selector.
        swapRouter.setApprovedDex(dex, true);
        swapRouter.setApprovedSwapSelector(DEX_SELECTOR, true);
    }

    function _makeSwapData(uint256 amount) internal view returns (LibSwap.SwapData[] memory) {
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: dex,
            approveTo: dex,
            sendingAssetId: address(weth),
            receivingAssetId: address(mockUsdc),
            fromAmount: amount,
            callData: abi.encodePacked(DEX_SELECTOR),
            requiresDeposit: false
        });
        return swaps;
    }

    /// @notice Fuzz: any amount deposits fully, router ends at 0.
    function testFuzz_swapAndDeposit_amount(uint256 amount) public {
        amount = bound(amount, 1, 1e12 * 1e6); // 1 wei to 1T USDC equiv

        weth.mint(user, amount);
        vm.prank(user);
        weth.approve(address(swapRouter), amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(keyAdapter, 10000, 0, "");

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _makeSwapData(amount), entries);

        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "router must hold 0 USDC");
        assertEq(weth.balanceOf(address(swapRouter)), 0, "router must hold 0 WETH");
    }

    /// @notice Fuzz: random 2-way BPS split. No dust, proportions correct.
    function testFuzz_swapAndDeposit_bpsSplit(uint16 bps1) public {
        bps1 = uint16(bound(bps1, 1, 9999));
        uint16 bps2 = 10000 - bps1;

        uint256 amount = 1_000_000e6; // 1M USDC equiv
        weth.mint(user, amount);
        vm.prank(user);
        weth.approve(address(swapRouter), amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](2);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, bps1, 0, "");
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, bps2, 0, "");

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _makeSwapData(amount), entries);

        // Verify no dust left in router
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "no dust");

        // Verify adapter got remainder (last entry)
        uint256 expectedFirst = (amount * uint256(bps1)) / 10000;
        uint256 expectedSecond = amount - expectedFirst;
        assertEq(adapter.lastAmount(), expectedSecond, "adapter got remainder");
    }

    /// @notice Fuzz: random 3-way BPS split. No dust in router.
    function testFuzz_swapAndDeposit_threeWaySplit(uint16 bps1, uint16 bps2) public {
        bps1 = uint16(bound(bps1, 1, 9998));
        bps2 = uint16(bound(bps2, 1, 9999 - bps1));
        uint16 bps3 = 10000 - bps1 - bps2;

        uint256 amount = 1_000_000e6;
        weth.mint(user, amount);
        vm.prank(user);
        weth.approve(address(swapRouter), amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](3);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, bps1, 0, "");
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, bps2, 0, "");
        entries[2] = FortSwapRouter.SwapDepositEntry(keyAdapterEx, bps3, 0, "");

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _makeSwapData(amount), entries);

        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "no dust in router");
        assertEq(weth.balanceOf(address(swapRouter)), 0, "no weth in router");
    }

    /// @dev Helper: queue fee, warp past delay, execute
    function _setFeeViaTimelock(uint16 feeBps) internal {
        vault.queueDepositFeeBps(feeBps);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);
        vault.executeDepositFeeBps();
    }

    /// @notice Fuzz: random fee BPS. Fee recipient gets exact fee, protocol gets remainder.
    function testFuzz_swapAndDeposit_withFee(uint16 feeBps) public {
        feeBps = uint16(bound(feeBps, 0, 500));

        if (feeBps > 0) {
            _setFeeViaTimelock(feeBps);
        }

        uint256 amount = 1_000_000e6;
        weth.mint(user, amount);
        vm.prank(user);
        weth.approve(address(swapRouter), amount);

        address feeRecipient = vault.feeRecipient();
        uint256 recipientBefore = mockUsdc.balanceOf(feeRecipient);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(keyAdapter, 10000, 0, "");

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _makeSwapData(amount), entries);

        uint256 expectedFee = (amount * uint256(feeBps)) / 10000;
        uint256 expectedNet = amount - expectedFee;

        assertEq(mockUsdc.balanceOf(feeRecipient) - recipientBefore, expectedFee, "fee amount");
        assertEq(adapter.lastAmount(), expectedNet, "net to protocol");
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "router empty");
    }
}
