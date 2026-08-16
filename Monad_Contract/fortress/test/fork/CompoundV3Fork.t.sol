// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "../../src/adapters/CompoundV3Adapter.sol";
import "../../src/interfaces/IComet.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CompoundV3ForkTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant COMPOUND_COMET = 0xb125E6687d4313864e53df431d5425969c15Eb2F;

    FortVault internal vault;
    CompoundV3Adapter internal adapter;
    IComet internal comet;
    address internal user = address(0xA1);
    bytes32 internal compoundKey;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        comet = IComet(COMPOUND_COMET);

        // Deploy vault
        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        // Deploy adapter
        CompoundV3Adapter adapterImpl = new CompoundV3Adapter(USDC, COMPOUND_COMET);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl),
            abi.encodeCall(CompoundV3Adapter.initialize, (address(this), address(vault)))
        );
        adapter = CompoundV3Adapter(address(adapterProxy));

        // Register
        vault.registerProtocol("CompoundV3", address(adapter), false);
        compoundKey = keccak256(bytes("CompoundV3"));
    }

    function test_fork_compound_deposit() public {
        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(compoundKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        uint256 cometBalance = comet.balanceOf(user);
        assertGt(cometBalance, 0, "User should have cUSDCv3 balance");
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
    }

    function test_fork_compound_depositAndWithdraw() public {
        uint256 amount = 500e6;
        deal(USDC, user, amount);

        // Deposit
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(compoundKey, amount, 0, "");
        vault.deposit(dEntries);

        // User must allow adapter to withdraw from Comet
        comet.allow(address(adapter), true);

        // Withdraw
        uint256 cometBal = comet.balanceOf(user);
        FortVault.WithdrawEntry[] memory wEntries = new FortVault.WithdrawEntry[](1);
        wEntries[0] = FortVault.WithdrawEntry(compoundKey, cometBal, 0, "");
        vault.withdraw(wEntries);
        vm.stopPrank();

        uint256 usdcBack = IERC20(USDC).balanceOf(user);
        assertApproxEqAbs(usdcBack, amount, 2, "Should get ~same USDC back");
        assertEq(comet.balanceOf(user), 0, "Should have zero Comet balance");
    }

    function test_fork_compound_largeDeposit() public {
        uint256 amount = 1_000_000e6; // 1M USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(compoundKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        assertGt(comet.balanceOf(user), 0);
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0);
    }
}
