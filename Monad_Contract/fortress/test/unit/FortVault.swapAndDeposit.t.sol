// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../helpers/FortVaultTestBase.sol";
import "../mocks/MockERC4626Vault.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockFortProtocolEx.sol";
import "../mocks/MockLiFiDiamond.sol";
import "../../src/FortSwapRouter.sol";
import "../../src/interfaces/ILiFi.sol";

contract FortVaultSwapAndDepositTest is FortVaultTestBase {
    MockERC4626Vault internal erc4626;
    MockFortProtocol internal adapter;
    MockFortProtocolEx internal adapterEx;
    MockLiFiDiamond internal lifi;
    MockUSDC internal weth; // mock "WETH" as another ERC20
    FortSwapRouter internal swapRouter;

    address internal user = address(0xA1);
    address internal nonOwner = address(0xB1);

    /// @dev A LI.FI leg's `callTo`/`approveTo` is the DEX, never the diamond.
    ///      Kept distinct so a test cannot pass by conflating them — the Base-era
    ///      `approveTo == lifiDiamond` rule survived CI precisely because they were.
    address internal dex = address(0xDE);

    /// @dev Stand-in for a venue's swap entry point. Never executed: the mock
    ///      diamond simulates the leg rather than calling into it.
    bytes4 internal constant DEX_SELECTOR = bytes4(keccak256("swap(address,address,uint256,uint256)"));
    bytes32 internal key4626;
    bytes32 internal keyAdapter;
    bytes32 internal keyAdapterEx;

    function setUp() public override {
        super.setUp();

        // Deploy mocks
        erc4626 = new MockERC4626Vault(mockUsdc);
        adapter = new MockFortProtocol(address(mockUsdc));
        adapterEx = new MockFortProtocolEx(address(mockUsdc));
        weth = new MockUSDC(); // reuse MockUSDC as generic ERC20

        // Deploy LiFi mock at 1:1 rate, fund with USDC
        lifi = new MockLiFiDiamond(1e6);
        mockUsdc.mint(address(lifi), 1_000_000e6);

        // Register protocols
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
        // I5 is two allowlists, not one: the leg's target AND its selector.
        swapRouter.setApprovedDex(dex, true);
        swapRouter.setApprovedSwapSelector(DEX_SELECTOR, true);
    }

    // ──────────── Helpers ────────────

    function _mintWethAndApprove(address who, uint256 amount) internal {
        weth.mint(who, amount);
        vm.prank(who);
        weth.approve(address(swapRouter), amount);
    }

    function _defaultSwapData(uint256 amount) internal view returns (LibSwap.SwapData[] memory) {
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

    function _singleEntry(bytes32 key) internal pure returns (FortSwapRouter.SwapDepositEntry[] memory) {
        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(key, 10000, 0, "");
        return entries;
    }

    // ══════════════════════════════════════════════════
    //              HAPPY PATH
    // ══════════════════════════════════════════════════

    function test_swapAndDeposit_singleProtocol() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth),
            amount,
            amount, // 1:1 rate, expect full amount
            block.timestamp + 1,
            _defaultSwapData(amount),
            _singleEntry(keyAdapter)
        );

        assertEq(adapter.depositCallCount(), 1);
        assertEq(adapter.lastReceiver(), user);
        assertEq(adapter.lastAmount(), amount);
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "router should hold 0 USDC");
        assertEq(weth.balanceOf(address(swapRouter)), 0, "router should hold 0 WETH");
    }

    function test_swapAndDeposit_multiProtocol() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](2);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 6000, 0, ""); // 60%
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, 4000, 0, ""); // 40%

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);

        assertEq(adapter.lastAmount(), 400e6);
        assertGt(erc4626.balanceOf(user), 0);
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0);
    }

    function test_swapAndDeposit_threeWaySplit() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](3);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 3333, 0, "");
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, 3333, 0, "");
        entries[2] = FortSwapRouter.SwapDepositEntry(keyAdapterEx, 3334, 0, "");

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);

        // last entry gets remainder: 1000e6 - 333.3e6 - 333.3e6 = 333.4e6
        uint256 e0 = (amount * 3333) / 10000; // 333_300_000
        uint256 e1 = (amount * 3333) / 10000; // 333_300_000
        uint256 e2 = amount - e0 - e1; // 333_400_000

        assertEq(adapter.lastAmount(), e1);
        assertEq(adapterEx.lastAmount(), e2);
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "no dust");
    }

    function test_swapAndDeposit_withProtocolData() public {
        uint256 amount = 500e6;
        _mintWethAndApprove(user, amount);

        bytes memory testData = abi.encode(uint256(42), address(0xDEAD));
        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(keyAdapterEx, 10000, 0, testData);

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);

        assertEq(adapterEx.depositExCallCount(), 1);
        assertEq(adapterEx.lastData(), testData);
    }

    function test_swapAndDeposit_emitsEvent() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        vm.expectEmit(true, true, false, true);
        emit FortSwapRouter.SwapAndDeposited(user, address(weth), amount, amount, 1);

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );
    }

    // ══════════════════════════════════════════════════
    //              REVERT TESTS
    // ══════════════════════════════════════════════════

    function test_swapAndDeposit_zeroAmount_reverts() public {
        vm.prank(user);
        vm.expectRevert(FortSwapRouter.ZeroAmount.selector);
        swapRouter.swapAndDeposit(
            address(weth), 0, 0, block.timestamp + 1, _defaultSwapData(0), _singleEntry(keyAdapter)
        );
    }

    function test_swapAndDeposit_invalidBps_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](2);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 5000, 0, "");
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, 4000, 0, ""); // sum = 9000

        vm.prank(user);
        vm.expectRevert(FortSwapRouter.InvalidBps.selector);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);
    }

    function test_swapAndDeposit_slippageExceeded_reverts() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        // Set LiFi rate to 50% (0.5:1) — mock reverts with "slippage" before
        // our SlippageExceeded fires (LiFi enforces its own minAmount check).
        lifi.setRate(0.5e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(MockLiFiDiamond.MockSlippage.selector, amount / 2, amount));
        swapRouter.swapAndDeposit(
            address(weth),
            amount,
            amount, // expect full amount but only get 50%
            block.timestamp + 1,
            _defaultSwapData(amount),
            _singleEntry(keyAdapter)
        );
    }

    function test_swapAndDeposit_deadlineExpired_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        vm.prank(user);
        vm.expectRevert(FortSwapRouter.DeadlineExpired.selector);
        swapRouter.swapAndDeposit(
            address(weth),
            amount,
            amount,
            block.timestamp - 1, // already expired
            _defaultSwapData(amount),
            _singleEntry(keyAdapter)
        );
    }

    function test_swapAndDeposit_unauthorizedCallTo_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        address badDex = address(0xBAD);
        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].callTo = badDex;

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.UnauthorizedCallTo.selector, badDex));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    function test_swapAndDeposit_unauthorizedApproveTo_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        address badApprove = address(0xBAD);
        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].approveTo = badApprove;

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.UnauthorizedApproveTo.selector, badApprove));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    /// @notice The diamond is not a valid leg target. The Base rule REQUIRED it to
    ///         be `approveTo`, which is the shape that must now be rejected.
    function test_swapAndDeposit_diamondAsApproveTo_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].approveTo = address(lifi);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.UnauthorizedApproveTo.selector, address(lifi)));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    /// @notice I5 — an allowlisted router still exposes every other function it has.
    function test_swapAndDeposit_unauthorizedSelector_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        bytes4 bad = bytes4(keccak256("sweep(address)"));
        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].callData = abi.encodePacked(bad);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.UnauthorizedSelector.selector, bad));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    /// @notice The route must actually end in USDC — that is what gets deposited.
    function test_swapAndDeposit_routeEndAssetMismatch_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].receivingAssetId = address(weth);

        vm.prank(user);
        vm.expectRevert(FortSwapRouter.AssetMismatch.selector);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    function test_swapAndDeposit_routeStartAssetMismatch_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        MockUSDC other = new MockUSDC();
        LibSwap.SwapData[] memory swaps = _defaultSwapData(amount);
        swaps[0].sendingAssetId = address(other);

        vm.prank(user);
        vm.expectRevert(FortSwapRouter.AssetMismatch.selector);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, swaps, _singleEntry(keyAdapter));
    }

    /// @notice The selector list ships empty and must fail closed.
    function test_swapAndDeposit_selectorAllowlistFailsClosed() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        FortSwapRouter impl = new FortSwapRouter(address(mockUsdc), address(lifi));
        FortSwapRouter fresh = FortSwapRouter(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FortSwapRouter.initialize, (address(this), address(vault)))
                )
            )
        );
        fresh.setApprovedDex(dex, true); // addresses configured, selectors not

        vm.prank(user);
        weth.approve(address(fresh), amount);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.UnauthorizedSelector.selector, DEX_SELECTOR));
        fresh.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );
    }

    function test_swapAndDeposit_unknownProtocol_reverts() public {
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);

        bytes32 badKey = keccak256(bytes("Unknown"));
        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(badKey, 10000, 0, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.ProtocolNotFound.selector, badKey));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);
    }

    function test_swapAndDeposit_whenPaused_reverts() public {
        swapRouter.pause();

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        swapRouter.swapAndDeposit(
            address(weth), 100e6, 100e6, block.timestamp + 1, _defaultSwapData(100e6), _singleEntry(keyAdapter)
        );
    }

    function test_swapAndDeposit_inputTokenIsUsdc_reverts() public {
        uint256 amount = 100e6;
        mockUsdc.mint(user, amount);
        vm.prank(user);
        mockUsdc.approve(address(swapRouter), amount);

        vm.prank(user);
        vm.expectRevert(FortSwapRouter.InputTokenIsUsdc.selector);
        swapRouter.swapAndDeposit(
            address(mockUsdc), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );
    }

    // ══════════════════════════════════════════════════
    //              ADMIN TESTS
    // ══════════════════════════════════════════════════

    function test_setApprovedDex() public {
        address dex = address(0xDE);
        swapRouter.setApprovedDex(dex, true);
        assertTrue(swapRouter.isApprovedDex(dex));

        swapRouter.setApprovedDex(dex, false);
        assertFalse(swapRouter.isApprovedDex(dex));
    }

    function test_setApprovedDex_emitsEvent() public {
        address dex = address(0xDE);
        vm.expectEmit(true, false, false, true);
        emit FortSwapRouter.DexApprovalUpdated(dex, true);
        swapRouter.setApprovedDex(dex, true);
    }

    function test_setApprovedDex_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nonOwner));
        swapRouter.setApprovedDex(address(0xDE), true);
    }

    // ══════════════════════════════════════════════════
    //              SET VAULT
    // ══════════════════════════════════════════════════

    function test_setVault_works() public {
        address newVault = address(0xCAFE);
        swapRouter.setVault(newVault);
        assertEq(swapRouter.vault(), newVault);
    }

    function test_setVault_emitsEvent() public {
        address oldVault = swapRouter.vault();
        address newVault = address(0xCAFE);

        vm.expectEmit(true, true, false, false);
        emit FortSwapRouter.VaultUpdated(oldVault, newVault);
        swapRouter.setVault(newVault);
    }

    function test_setVault_zeroAddress_reverts() public {
        vm.expectRevert(FortSwapRouter.ZeroAddress.selector);
        swapRouter.setVault(address(0));
    }

    function test_setVault_nonOwner_reverts() public {
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nonOwner));
        swapRouter.setVault(address(0xCAFE));
    }

    // ══════════════════════════════════════════════════
    //              RESCUE TOKEN
    // ══════════════════════════════════════════════════

    function test_rescueToken_owner_succeeds() public {
        weth.mint(address(swapRouter), 500e6);
        uint256 before = weth.balanceOf(address(this));
        swapRouter.rescueToken(address(weth), address(this), 500e6);
        assertEq(weth.balanceOf(address(this)) - before, 500e6);
        assertEq(weth.balanceOf(address(swapRouter)), 0);
    }

    function test_rescueToken_usdc() public {
        mockUsdc.mint(address(swapRouter), 200e6);
        uint256 before = mockUsdc.balanceOf(address(this));
        swapRouter.rescueToken(address(mockUsdc), address(this), 200e6);
        assertEq(mockUsdc.balanceOf(address(this)) - before, 200e6);
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0);
    }

    function test_rescueToken_nonOwner_reverts() public {
        weth.mint(address(swapRouter), 100e6);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", nonOwner));
        swapRouter.rescueToken(address(weth), nonOwner, 100e6);
    }

    // ══════════════════════════════════════════════════
    //              FEE COLLECTION VIA VAULT INTERFACE
    // ══════════════════════════════════════════════════

    /// @dev Helper: queue fee, warp past delay, execute
    function _setFeeViaTimelock(uint16 feeBps) internal {
        vault.queueDepositFeeBps(feeBps);
        vm.warp(block.timestamp + vault.feeTimelockDelay() + 1);
        vault.executeDepositFeeBps();
    }

    function test_swapAndDeposit_withFee_deductsFee() public {
        _setFeeViaTimelock(200); // 2%

        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );

        uint256 expectedFee = (amount * 200) / 10000; // 20 USDC
        uint256 expectedNet = amount - expectedFee; // 980 USDC

        assertEq(mockUsdc.balanceOf(owner) - ownerBefore, expectedFee, "fee to owner");
        assertEq(adapter.lastAmount(), expectedNet, "net to protocol");
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "router empty");
    }

    function test_swapAndDeposit_withFee_goesToRecipient() public {
        address treasury = address(0xBEEF);
        vault.setFeeRecipient(treasury);
        _setFeeViaTimelock(200); // 2%

        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );

        uint256 expectedFee = (amount * 200) / 10000;
        assertEq(mockUsdc.balanceOf(treasury), expectedFee, "fee to treasury");
        assertEq(mockUsdc.balanceOf(owner), 0, "owner gets nothing");
    }

    function test_swapAndDeposit_zeroFee_fullAmount() public {
        // fee defaults to 0
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );

        assertEq(mockUsdc.balanceOf(owner), ownerBefore, "no fee taken");
        assertEq(adapter.lastAmount(), amount, "full amount deposited");
    }

    function test_swapAndDeposit_withFee_multiProtocol() public {
        _setFeeViaTimelock(200); // 2%

        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](2);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 6000, 0, ""); // 60%
        entries[1] = FortSwapRouter.SwapDepositEntry(keyAdapter, 4000, 0, ""); // 40%

        uint256 ownerBefore = mockUsdc.balanceOf(owner);

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);

        uint256 expectedFee = (amount * 200) / 10000; // 20
        uint256 netAmount = amount - expectedFee; // 980

        assertEq(mockUsdc.balanceOf(owner) - ownerBefore, expectedFee, "fee correct");

        uint256 expectedFirst = (netAmount * 6000) / 10000; // 588
        uint256 expectedSecond = netAmount - expectedFirst; // 392

        assertEq(adapter.lastAmount(), expectedSecond, "adapter got remainder");
        assertGt(erc4626.balanceOf(user), 0, "user got ERC4626 shares");
        assertEq(mockUsdc.balanceOf(address(swapRouter)), 0, "router empty");
    }

    // ══════════════════════════════════════════════════
    //              ERC4626 MIN SHARES OUT SLIPPAGE
    // ══════════════════════════════════════════════════

    function test_swapAndDeposit_erc4626_minSharesOut_passes() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        // MockERC4626Vault is 1:1, so shares == amount
        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 10000, amount, ""); // minSharesOut == amount

        vm.prank(user);
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);

        assertEq(erc4626.balanceOf(user), amount, "shares received");
    }

    function test_swapAndDeposit_erc4626_minSharesOut_reverts() public {
        uint256 amount = 1000e6;
        _mintWethAndApprove(user, amount);

        // Request more shares than possible
        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(key4626, 10000, amount + 1, ""); // minSharesOut > actual

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FortSwapRouter.SlippageExceeded.selector, amount, amount + 1));
        swapRouter.swapAndDeposit(address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), entries);
    }

    // ══════════════════════════════════════════════════
    //              PAUSE ROUND-TRIP
    // ══════════════════════════════════════════════════

    function test_pause_unpause_restoresFunction() public {
        swapRouter.pause();

        // Should revert while paused
        uint256 amount = 100e6;
        _mintWethAndApprove(user, amount);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );

        // Unpause and retry — should succeed
        swapRouter.unpause();

        vm.prank(user);
        swapRouter.swapAndDeposit(
            address(weth), amount, amount, block.timestamp + 1, _defaultSwapData(amount), _singleEntry(keyAdapter)
        );

        assertEq(adapter.lastAmount(), amount);
    }

    // ══════════════════════════════════════════════════
    //              CONSTRUCTOR
    // ══════════════════════════════════════════════════

    function test_constructor_setsImmutables() public {
        FortSwapRouter impl = new FortSwapRouter(address(mockUsdc), address(lifi));
        assertEq(address(impl.usdc()), address(mockUsdc));
        assertEq(impl.lifiDiamond(), address(lifi));
    }

    function test_constructor_zeroAddress_reverts() public {
        vm.expectRevert(FortSwapRouter.ZeroAddress.selector);
        new FortSwapRouter(address(0), address(lifi));

        vm.expectRevert(FortSwapRouter.ZeroAddress.selector);
        new FortSwapRouter(address(mockUsdc), address(0));
    }

    // ══════════════════════════════════════════════════
    //              INITIALIZE
    // ══════════════════════════════════════════════════

    function test_initialize_setsState() public {
        FortSwapRouter impl = new FortSwapRouter(address(mockUsdc), address(lifi));
        ERC1967Proxy proxy =
            new ERC1967Proxy(address(impl), abi.encodeCall(FortSwapRouter.initialize, (address(0xAA), address(0xBB))));
        FortSwapRouter fresh = FortSwapRouter(address(proxy));
        assertEq(fresh.owner(), address(0xAA));
        assertEq(fresh.vault(), address(0xBB));
    }

    function test_initialize_zeroAddress_reverts() public {
        FortSwapRouter impl = new FortSwapRouter(address(mockUsdc), address(lifi));

        vm.expectRevert(FortSwapRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FortSwapRouter.initialize, (address(0), address(0xBB))));

        vm.expectRevert(FortSwapRouter.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FortSwapRouter.initialize, (address(0xAA), address(0))));
    }
}
