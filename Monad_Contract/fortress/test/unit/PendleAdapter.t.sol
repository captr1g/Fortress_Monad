// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/PendleAdapter.sol";
import "../../src/interfaces/IPendleRouter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockPendleRouter.sol";

contract PendleAdapterTest is Test {
    PendleAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal ptToken;
    MockPendleRouter internal pendleRouter;

    address internal owner = address(this);
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal market = address(0xAA);
    address internal ytToken = address(0xAB);
    uint256 internal constant DEADLINE = type(uint256).max;

    function setUp() public {
        usdc = new MockUSDC();
        ptToken = new MockUSDC();
        pendleRouter = new MockPendleRouter(address(usdc), address(ptToken), 1e6); // 1:1

        PendleAdapter impl = new PendleAdapter(address(usdc), address(pendleRouter));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(PendleAdapter.initialize, (owner, vault)));
        adapter = PendleAdapter(address(proxy));
        adapter.setApprovedMarket(market, true);
    }

    // ──── depositFor (no data) — reverts ────

    function test_depositFor_noData_reverts() public {
        vm.expectRevert(PendleAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, user);
    }

    function test_redeemFor_noData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(PendleAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, user, user);
    }

    // ──── depositFor (with data) ────

    function test_depositFor_withData() public {
        uint256 amount = 1000e6;
        uint256 minPtOut = 900e6;

        // Fund mock router with PT for output
        ptToken.mint(address(pendleRouter), amount);
        usdc.mint(vault, amount);

        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams({
            guessMin: 0,
            guessMax: type(uint256).max,
            guessOffchain: 0,
            maxIteration: 256,
            eps: 1e15
        });

        bytes memory data = abi.encode(market, minPtOut, guess, DEADLINE);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user, data);
        vm.stopPrank();

        assertEq(pendleRouter.swapTokenForPtCount(), 1);
        assertEq(pendleRouter.lastReceiver(), user);
        assertEq(ptToken.balanceOf(user), amount); // 1:1 rate
        assertEq(usdc.balanceOf(vault), 0);
    }

    function test_depositFor_zeroAmount_reverts() public {
        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams(0, 0, 0, 0, 0);
        bytes memory data = abi.encode(market, uint256(0), guess, DEADLINE);

        vm.prank(vault);
        vm.expectRevert(PendleAdapter.ZeroAmount.selector);
        adapter.depositFor(0, user, data);
    }

    function test_depositFor_expiredDeadline_reverts() public {
        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams(0, 0, 0, 0, 0);
        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(market, uint256(0), guess, pastDeadline);

        vm.prank(vault);
        vm.expectRevert(PendleAdapter.DeadlineExpired.selector);
        adapter.depositFor(1000e6, user, data);
    }

    function test_depositFor_unauthorizedMarket_reverts() public {
        address badMarket = address(0xDEAD);
        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams(0, 0, 0, 0, 0);
        bytes memory data = abi.encode(badMarket, uint256(0), guess, DEADLINE);

        usdc.mint(vault, 1000e6);
        vm.startPrank(vault);
        usdc.approve(address(adapter), 1000e6);

        vm.expectRevert(abi.encodeWithSelector(PendleAdapter.UnauthorizedMarket.selector, badMarket));
        adapter.depositFor(1000e6, user, data);
        vm.stopPrank();
    }

    // ──── redeemFor (pre-maturity) ────

    function test_redeemFor_preMaturity() public {
        uint256 shares = 500e6;
        uint256 minTokenOut = 400e6;

        // Fund mock router with USDC for output
        usdc.mint(address(pendleRouter), shares);
        ptToken.mint(user, shares);

        bytes memory data = abi.encode(market, address(ptToken), minTokenOut, false, DEADLINE);

        vm.prank(user);
        ptToken.approve(address(adapter), shares);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(shares, receiver, user, data);

        assertEq(pendleRouter.swapPtForTokenCount(), 1);
        assertEq(usdc.balanceOf(receiver), shares); // 1:1 rate
        assertEq(usdcOut, shares);
    }

    // ──── redeemFor (post-maturity) ────

    function test_redeemFor_postMaturity() public {
        uint256 shares = 500e6;
        uint256 minTokenOut = 400e6;

        // Fund mock router with USDC for output
        usdc.mint(address(pendleRouter), shares);
        ptToken.mint(user, shares);

        bytes memory data = abi.encode(market, address(ptToken), minTokenOut, true, DEADLINE, ytToken);

        vm.prank(user);
        ptToken.approve(address(adapter), shares);

        address receiver = address(0xBB);
        vm.prank(vault);
        uint256 usdcOut = adapter.redeemFor(shares, receiver, user, data);

        assertEq(pendleRouter.redeemPyCount(), 1);
        assertEq(usdc.balanceOf(receiver), shares); // 1:1 maturity redemption
        assertEq(usdcOut, shares);
    }

    function test_redeemFor_zeroShares_reverts() public {
        bytes memory data = abi.encode(market, address(ptToken), uint256(0), false, DEADLINE);

        vm.prank(vault);
        vm.expectRevert(PendleAdapter.ZeroAmount.selector);
        adapter.redeemFor(0, user, user, data);
    }

    function test_redeemFor_expiredDeadline_reverts() public {
        uint256 pastDeadline = block.timestamp - 1;
        bytes memory data = abi.encode(market, address(ptToken), uint256(0), false, pastDeadline);

        vm.prank(vault);
        vm.expectRevert(PendleAdapter.DeadlineExpired.selector);
        adapter.redeemFor(100e6, user, user, data);
    }

    function test_redeemFor_unauthorizedMarket_reverts() public {
        address badMarket = address(0xDEAD);
        bytes memory data = abi.encode(badMarket, address(ptToken), uint256(0), false, DEADLINE);

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(PendleAdapter.UnauthorizedMarket.selector, badMarket));
        adapter.redeemFor(100e6, user, user, data);
    }

    // ──── Owner functions ────

    function test_setApprovedMarket() public {
        address newMarket = address(0xCC);
        assertEq(adapter.isApprovedMarket(newMarket), false);

        adapter.setApprovedMarket(newMarket, true);
        assertEq(adapter.isApprovedMarket(newMarket), true);

        adapter.setApprovedMarket(newMarket, false);
        assertEq(adapter.isApprovedMarket(newMarket), false);
    }

    function test_setApprovedMarket_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.setApprovedMarket(address(0xCC), true);
    }

    function test_rescueToken() public {
        uint256 stuck = 100e6;
        usdc.mint(address(adapter), stuck);

        address recipient = address(0xCC);
        adapter.rescueToken(address(usdc), recipient, stuck);

        assertEq(usdc.balanceOf(recipient), stuck);
    }

    function test_rescueToken_nonOwner_reverts() public {
        usdc.mint(address(adapter), 100e6);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), user));
        adapter.rescueToken(address(usdc), user, 100e6);
    }
}
