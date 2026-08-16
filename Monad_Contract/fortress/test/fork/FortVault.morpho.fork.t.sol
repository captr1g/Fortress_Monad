// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract FortVaultMorphoForkTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant MORPHO_VAULT = 0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca;

    FortVault internal vault;
    address internal user = address(0xA1);
    bytes32 internal morphoKey;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        vault.registerProtocol("Morpho", MORPHO_VAULT, true);
        morphoKey = keccak256(bytes("Morpho"));
    }

    function test_fork_morpho_deposit() public {
        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(morphoKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        uint256 shares = IERC4626(MORPHO_VAULT).balanceOf(user);
        assertGt(shares, 0, "User should have Morpho shares");
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
    }

    function test_fork_morpho_depositAndWithdraw() public {
        uint256 amount = 500e6;
        deal(USDC, user, amount);

        // Deposit
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(morphoKey, amount, 0, "");
        vault.deposit(dEntries);

        // Withdraw
        uint256 shares = IERC4626(MORPHO_VAULT).balanceOf(user);
        IERC4626(MORPHO_VAULT).approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory wEntries = new FortVault.WithdrawEntry[](1);
        wEntries[0] = FortVault.WithdrawEntry(morphoKey, shares, 0, "");
        vault.withdraw(wEntries);
        vm.stopPrank();

        uint256 usdcBack = IERC20(USDC).balanceOf(user);
        // Allow 1 wei rounding loss
        assertApproxEqAbs(usdcBack, amount, 1, "Should get ~same USDC back");
        assertEq(IERC4626(MORPHO_VAULT).balanceOf(user), 0, "Should have zero shares");
    }

    function test_fork_morpho_largeDeposit() public {
        uint256 amount = 1_000_000e6; // 1M USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(morphoKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        assertGt(IERC4626(MORPHO_VAULT).balanceOf(user), 0);
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0);
    }

    function test_fork_morpho_assetIsUsdc() public {
        assertEq(IERC4626(MORPHO_VAULT).asset(), USDC, "Morpho vault asset should be USDC");
    }
}
