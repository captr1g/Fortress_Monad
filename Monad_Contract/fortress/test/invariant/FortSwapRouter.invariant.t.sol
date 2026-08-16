// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortVault.sol";
import "../../src/FortSwapRouter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockFortProtocol.sol";
import "../mocks/MockLiFiDiamond.sol";

/// @notice Handler that wraps FortSwapRouter operations for invariant fuzzing.
contract FortSwapRouterHandler is Test {
    FortSwapRouter public router;
    MockLiFiDiamond public lifi;
    MockFortProtocol public protocol;
    MockUSDC public usdc;
    MockUSDC public weth;
    bytes32 public protocolKey;

    address internal user = address(0xA1);

    constructor(
        FortSwapRouter _router,
        MockLiFiDiamond _lifi,
        MockFortProtocol _protocol,
        MockUSDC _usdc,
        MockUSDC _weth,
        bytes32 _protocolKey
    ) {
        router = _router;
        lifi = _lifi;
        protocol = _protocol;
        usdc = _usdc;
        weth = _weth;
        protocolKey = _protocolKey;
    }

    /// @notice Execute a swap-and-deposit with a bounded amount.
    function doSwapAndDeposit(uint256 amount) external {
        amount = bound(amount, 1, 1e12);

        weth.mint(user, amount);
        vm.prank(user);
        weth.approve(address(router), amount);

        LibSwap.SwapData[] memory swaps = new LibSwap.SwapData[](1);
        swaps[0] = LibSwap.SwapData({
            callTo: address(lifi),
            approveTo: address(lifi),
            sendingAssetId: address(weth),
            receivingAssetId: address(usdc),
            fromAmount: amount,
            callData: "",
            requiresDeposit: false
        });

        FortSwapRouter.SwapDepositEntry[] memory entries = new FortSwapRouter.SwapDepositEntry[](1);
        entries[0] = FortSwapRouter.SwapDepositEntry(protocolKey, 10000, 0, "");

        vm.prank(user);
        try router.swapAndDeposit(
            address(weth),
            amount,
            amount,
            block.timestamp + 1,
            swaps,
            entries
        ) {} catch {}
    }

    /// @notice Toggle pause/unpause.
    function togglePause(bool doPause) external {
        if (doPause) {
            try router.pause() {} catch {}
        } else {
            try router.unpause() {} catch {}
        }
    }
}

contract FortSwapRouterInvariantTest is Test {
    FortVault internal vault;
    FortSwapRouter internal swapRouter;
    MockUSDC internal usdc;
    MockUSDC internal weth;
    MockLiFiDiamond internal lifi;
    MockFortProtocol internal protocol;
    FortSwapRouterHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        weth = new MockUSDC();

        // Deploy vault
        FortVault vaultImpl = new FortVault();
        ERC1967Proxy vaultProxy = new ERC1967Proxy(
            address(vaultImpl),
            abi.encodeCall(FortVault.initialize, (address(usdc)))
        );
        vault = FortVault(address(vaultProxy));

        // Deploy protocol + register
        protocol = new MockFortProtocol(address(usdc));
        vault.registerProtocol("Adapter", address(protocol), false);
        bytes32 protocolKey = keccak256(bytes("Adapter"));

        // Deploy LiFi mock, fund with USDC
        lifi = new MockLiFiDiamond(1e6);
        usdc.mint(address(lifi), type(uint128).max);

        // Deploy FortSwapRouter
        FortSwapRouter routerImpl = new FortSwapRouter(address(usdc), address(lifi));
        ERC1967Proxy routerProxy = new ERC1967Proxy(
            address(routerImpl),
            abi.encodeCall(FortSwapRouter.initialize, (address(this), address(vault)))
        );
        swapRouter = FortSwapRouter(address(routerProxy));
        swapRouter.setApprovedDex(address(lifi), true);

        // Deploy handler
        handler = new FortSwapRouterHandler(swapRouter, lifi, protocol, usdc, weth, protocolKey);

        // Only fuzz through handler
        targetContract(address(handler));
    }

    /// @notice Router should never hold USDC after any operation.
    function invariant_routerHoldsNoUSDC() public view {
        assertEq(usdc.balanceOf(address(swapRouter)), 0, "router holds USDC");
    }

    /// @notice Router should never hold WETH after any operation.
    function invariant_routerHoldsNoWETH() public view {
        assertEq(weth.balanceOf(address(swapRouter)), 0, "router holds WETH");
    }
}
