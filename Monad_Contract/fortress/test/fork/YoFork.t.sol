// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "../../src/adapters/YoAdapter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Fork test for YoAdapter on Base mainnet.
///         Requires BASE_RPC_URL env var.
contract YoForkTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant YO_USD = 0x0000000f2eB9f69274678c76222B35eEc7588a65;

    FortVault internal vault;
    YoAdapter internal adapter;
    address internal user = address(0xA1);
    bytes32 internal yoKey;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // Deploy vault
        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        // Deploy adapter
        YoAdapter adapterImpl = new YoAdapter(USDC, YO_USD);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl),
            abi.encodeCall(YoAdapter.initialize, (address(this), address(vault)))
        );
        adapter = YoAdapter(address(adapterProxy));

        // Register
        vault.registerProtocol("Yo", address(adapter), false);
        yoKey = keccak256(bytes("Yo"));
    }

    function test_fork_yo_deposit() public {
        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(yoKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        uint256 yoBalance = IERC20(YO_USD).balanceOf(user);
        assertGt(yoBalance, 0, "User should have yoUSD balance");
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
    }

    function test_fork_yo_depositAndWithdraw() public {
        uint256 amount = 500e6;
        deal(USDC, user, amount);

        // Deposit
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(yoKey, amount, 0, "");
        vault.deposit(dEntries);

        // Approve adapter for yoUSD
        uint256 yoBal = IERC20(YO_USD).balanceOf(user);
        IERC20(YO_USD).approve(address(adapter), yoBal);

        // Withdraw
        FortVault.WithdrawEntry[] memory wEntries = new FortVault.WithdrawEntry[](1);
        wEntries[0] = FortVault.WithdrawEntry(yoKey, yoBal, 0, "");
        vault.withdraw(wEntries);
        vm.stopPrank();

        uint256 usdcBack = IERC20(USDC).balanceOf(user);
        assertGt(usdcBack, 0, "Should get USDC back");
        assertApproxEqRel(usdcBack, amount, 0.01e18, "Should get ~same USDC back (within 1%)");
    }

    function test_fork_yo_adapterDeploy() public {
        assertEq(address(adapter.usdc()), USDC);
        assertEq(address(adapter.yoVault()), YO_USD);
    }
}
