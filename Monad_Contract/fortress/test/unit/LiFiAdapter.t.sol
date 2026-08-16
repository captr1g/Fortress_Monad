// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";

contract LiFiAdapterTest is Test {
    LiFiAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal diamond;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6); // 1:1 rate

        LiFiAdapter impl = new LiFiAdapter(address(usdc), address(diamond));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)));
        adapter = LiFiAdapter(address(proxy));
        // Whitelist diamond as approved DEX
        adapter.setApprovedDex(address(diamond), true);
    }

    function _buildSwapDataFor(address input, address output, uint256 amount)
        internal
        view
        returns (LibSwap.SwapData[] memory)
    {
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: input,
            receivingAssetId: output,
            fromAmount: amount,
            callData: "",
            requiresDeposit: true
        });
        return swaps;
    }

    function _buildSwapData(uint256 amount) internal view returns (LibSwap.SwapData[] memory) {
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: amount,
            callData: "",
            requiresDeposit: true
        });
        return swaps;
    }

    function test_depositFor_withData() public {
        uint256 amount = 1000e6;
        uint256 minOut = 900e6;

        weth.mint(address(diamond), amount);
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);

        bytes memory data = abi.encode(_buildSwapData(amount), minOut, DEADLINE);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();

        assertEq(diamond.swapCallCount(), 1);
        assertEq(diamond.lastReceiver(), user);
        assertEq(weth.balanceOf(user), amount);
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_noData_reverts() public {
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_redeemFor_noData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    function test_redeemFor_withData() public {
        uint256 shares = 500e6;
        uint256 minUsdcOut = 400e6;

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: shares,
            callData: "",
            requiresDeposit: true
        });

        // Fund diamond with usdc for output — goes to adapter now (fix #3)
        usdc.mint(address(diamond), shares);
        weth.mint(user, shares);

        vm.prank(user);
        weth.approve(address(adapter), shares);

        bytes memory data = abi.encode(address(weth), swaps, minUsdcOut, DEADLINE);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(shares, receiver, user, data);

        assertEq(diamond.swapCallCount(), 1);
        assertEq(usdc.balanceOf(receiver), shares); // adapter forwards to receiver
        assertEq(usdcOut, shares);
    }

    function test_depositFor_overridesFromAmount() public {
        uint256 vaultAmount = 500e6;
        uint256 userSpecified = 9999e6;

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: userSpecified,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(address(diamond), vaultAmount);
        usdc.mint(vault, vaultAmount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), vaultAmount);

        bytes memory data = abi.encode(swaps, uint256(0), DEADLINE);
        adapter.depositFor(vaultAmount, user, data);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(diamond)), vaultAmount);
        assertEq(weth.balanceOf(user), vaultAmount);
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

    // ──── Security fix tests ────

    function test_depositFor_unauthorizedCallTo_reverts() public {
        address badDex = address(0xDEAD);
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: badDex,
            approveTo: address(diamond),
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: 100e6,
            callData: "",
            requiresDeposit: true
        });

        usdc.mint(vault, 100e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 100e6);

        bytes memory data = abi.encode(swaps, uint256(0), DEADLINE);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedCallTo.selector, badDex));
        adapter.depositFor(100e6, user, data);
        vm.stopPrank();
    }

    function test_depositFor_unauthorizedApproveTo_reverts() public {
        address badTarget = address(0xBAAD);
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: badTarget,
            sendingAssetId: address(usdc),
            receivingAssetId: address(weth),
            fromAmount: 100e6,
            callData: "",
            requiresDeposit: true
        });

        usdc.mint(vault, 100e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 100e6);

        bytes memory data = abi.encode(swaps, uint256(0), DEADLINE);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedApproveTo.selector, badTarget));
        adapter.depositFor(100e6, user, data);
        vm.stopPrank();
    }

    function test_depositFor_expiredDeadline_reverts() public {
        uint256 amount = 100e6;
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);

        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(_buildSwapData(amount), uint256(0), pastDeadline);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();
    }

    function test_redeemFor_expiredDeadline_reverts() public {
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: 100e6,
            callData: "",
            requiresDeposit: true
        });

        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(address(weth), swaps, uint256(0), pastDeadline);
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.redeemFor(100e6, user, user, data);
    }

    function test_setApprovedDex_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setApprovedDex(address(0xDEAD), true);
    }

    // ──── swap() tests ────

    function test_swap_happyPath() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), amount);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(usdc.balanceOf(address(adapter)), 0);
    }

    function test_swap_outputToUser() public {
        uint256 amount = 500e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), amount, "output to user");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds 0");
        assertEq(usdc.balanceOf(vault), 0, "vault holds 0");
    }

    function test_swap_residualInputSwept() public {
        uint256 amount = 500e6;
        uint256 preExisting = 100e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);
        weth.mint(address(adapter), preExisting); // simulate residual

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(weth.balanceOf(address(adapter)), 0, "adapter holds no input");
        assertEq(weth.balanceOf(user), preExisting, "residual swept to user");
    }

    function test_swap_unauthorizedCallTo_reverts() public {
        address badDex = address(0xDEAD);
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: badDex,
            approveTo: address(diamond),
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: 100e6,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(user, 100e6);
        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedCallTo.selector, badDex));
        adapter.swap(address(weth), 100e6, address(usdc), 0, DEADLINE, swaps);
        vm.stopPrank();
    }

    function test_swap_unauthorizedApproveTo_reverts() public {
        address badTarget = address(0xBAAD);
        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: badTarget,
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: 100e6,
            callData: "",
            requiresDeposit: true
        });

        weth.mint(user, 100e6);
        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedApproveTo.selector, badTarget));
        adapter.swap(address(weth), 100e6, address(usdc), 0, DEADLINE, swaps);
        vm.stopPrank();
    }

    function test_swap_expiredDeadline_reverts() public {
        weth.mint(user, 100e6);
        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(LiFiAdapter.DeadlineExpired.selector);
        adapter.swap(
            address(weth),
            100e6,
            address(usdc),
            0,
            block.timestamp - 1,
            _buildSwapDataFor(address(weth), address(usdc), 100e6)
        );
        vm.stopPrank();
    }

    function test_swap_zeroAmount_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAmount.selector);
        adapter.swap(address(weth), 0, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), 0));
    }

    function test_swap_zeroInputToken_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAddress.selector);
        adapter.swap(address(0), 100e6, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(0), address(usdc), 100e6));
    }

    function test_swap_zeroOutputToken_reverts() public {
        vm.prank(user);
        vm.expectRevert(LiFiAdapter.ZeroAddress.selector);
        adapter.swap(address(weth), 100e6, address(0), 0, DEADLINE, _buildSwapDataFor(address(weth), address(0), 100e6));
    }

    function test_swap_slippageExceeded_reverts() public {
        diamond.setRate(500_000); // 0.5x
        usdc.mint(address(diamond), 100e6);
        weth.mint(user, 100e6);

        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert("slippage");
        adapter.swap(
            address(weth), 100e6, address(usdc), 100e6, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), 100e6)
        );
        vm.stopPrank();
    }

    function test_swap_overridesFromAmount() public {
        uint256 userAmount = 500e6;
        uint256 calldataAmount = 9999e6;

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(diamond),
            approveTo: address(diamond),
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: calldataAmount,
            callData: "",
            requiresDeposit: true
        });

        usdc.mint(address(diamond), userAmount);
        weth.mint(user, userAmount);

        vm.startPrank(user);
        weth.approve(address(adapter), userAmount);
        adapter.swap(address(weth), userAmount, address(usdc), 0, DEADLINE, swaps);
        vm.stopPrank();

        assertEq(weth.balanceOf(address(diamond)), userAmount);
        assertEq(usdc.balanceOf(user), userAmount);
    }

    function test_swap_emitsSwappedEvent() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);

        vm.expectEmit(true, true, true, true, address(adapter));
        emit LiFiAdapter.Swapped(user, address(weth), address(usdc), amount, amount);

        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
        );
        vm.stopPrank();
    }

    function test_swap_approvalClearedAfter() public {
        uint256 amount = 1000e6;
        usdc.mint(address(diamond), amount);
        weth.mint(user, amount);

        vm.startPrank(user);
        weth.approve(address(adapter), amount);
        adapter.swap(
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
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
            address(weth), amount, address(usdc), 0, DEADLINE, _buildSwapDataFor(address(weth), address(usdc), amount)
        );
        vm.stopPrank();

        assertEq(usdc.balanceOf(randomUser), amount);
    }

    // ──── SameToken revert (NM-015) ────

    function test_swap_sameToken_reverts() public {
        weth.mint(user, 100e6);
        vm.startPrank(user);
        weth.approve(address(adapter), 100e6);
        vm.expectRevert(LiFiAdapter.SameToken.selector);
        adapter.swap(
            address(weth), 100e6, address(weth), 0, DEADLINE, _buildSwapDataFor(address(weth), address(weth), 100e6)
        );
        vm.stopPrank();
    }
}
