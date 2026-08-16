// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/PendleAdapter.sol";
import "../../src/interfaces/IPendleRouter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockPendleRouter.sol";

contract PendleAdapterFuzzTest is Test {
    PendleAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal ptToken;
    MockPendleRouter internal pendleRouter;

    address internal owner;
    address internal user = address(0xA1);
    address internal vault = address(0xBA);
    address internal market = address(0xAA);

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        ptToken = new MockUSDC();
        pendleRouter = new MockPendleRouter(address(usdc), address(ptToken), 1e6);

        PendleAdapter impl = new PendleAdapter(address(usdc), address(pendleRouter));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(PendleAdapter.initialize, (owner, vault))
        );
        adapter = PendleAdapter(address(proxy));
        adapter.setApprovedMarket(market, true);
    }

    function testFuzz_deposit_bounded(uint256 amt) public {
        amt = bound(amt, 1, 1e18);

        ptToken.mint(address(pendleRouter), amt);
        usdc.mint(vault, amt);

        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams({
            guessMin: 0,
            guessMax: type(uint256).max,
            guessOffchain: 0,
            maxIteration: 256,
            eps: 1e15
        });
        bytes memory data = abi.encode(market, uint256(0), guess, type(uint256).max);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amt);
        adapter.depositFor(amt, user, data);
        vm.stopPrank();

        assertEq(ptToken.balanceOf(user), amt, "pt balance mismatch");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds usdc");
    }
}
