// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/AerodromeAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockAerodromeRouter.sol";
import "../mocks/MockAerodromeGauge.sol";

contract AerodromeAdapterFuzzTest is Test {
    AerodromeAdapter internal adapter;
    MockUSDC internal usdc;
    MockUSDC internal pairedToken;
    MockUSDC internal lpToken;
    MockUSDC internal rewardToken;
    MockAerodromeRouter internal aeroRouter;
    MockAerodromeGauge internal gauge;

    address internal owner;
    address internal user = address(0xA1);
    address internal vault = address(0xBA);

    bytes32 internal poolKey;

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        pairedToken = new MockUSDC();
        lpToken = new MockUSDC();
        rewardToken = new MockUSDC();

        aeroRouter = new MockAerodromeRouter(1e18, address(lpToken));
        gauge = new MockAerodromeGauge(address(lpToken), address(rewardToken));

        AerodromeAdapter impl = new AerodromeAdapter(address(usdc), address(aeroRouter), address(0xFA));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(AerodromeAdapter.initialize, (owner, vault))
        );
        adapter = AerodromeAdapter(address(proxy));
        adapter.addPool("USDC-WETH", address(lpToken), address(gauge), address(pairedToken), false);
        poolKey = keccak256(bytes("USDC-WETH"));
    }

    function testFuzz_deposit_noTokensStuck(uint256 amt) public {
        amt = bound(amt, 2, 1e18); // min 2 because of halving

        usdc.mint(vault, amt);
        bytes memory data = abi.encode(poolKey, uint256(0), uint256(0), uint256(0), type(uint256).max);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amt);
        adapter.depositFor(amt, user, data);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter holds usdc");
        assertEq(pairedToken.balanceOf(address(adapter)), 0, "adapter holds paired");
        assertEq(lpToken.balanceOf(address(adapter)), 0, "adapter holds lp");
    }
}
