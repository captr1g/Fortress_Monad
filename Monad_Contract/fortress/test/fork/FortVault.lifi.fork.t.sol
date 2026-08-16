// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FortVaultLiFiForkTest is Test {
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant LIFI_DIAMOND = 0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE;

    LiFiAdapter internal adapter;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));
        LiFiAdapter adapterImpl = new LiFiAdapter(USDC, LIFI_DIAMOND);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl), abi.encodeCall(LiFiAdapter.initialize, (address(this), address(this)))
        );
        adapter = LiFiAdapter(address(adapterProxy));
    }

    function test_fork_lifi_adapterDeployed() public view {
        assertEq(address(adapter.usdc()), USDC);
        assertEq(adapter.lifiDiamond(), LIFI_DIAMOND);
    }

    function test_fork_lifi_depositWithoutData_reverts() public {
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, address(0xA1));
    }

    function test_fork_lifi_redeemWithoutData_reverts() public {
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, address(0xA1), address(0xA1));
    }
}
