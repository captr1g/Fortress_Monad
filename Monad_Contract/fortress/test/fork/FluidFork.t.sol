// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/interfaces/IERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../helpers/MonadFork.sol";

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract FluidForkTest is Test, MonadFork {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant FLUID_FUSDC = 0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169;

    FortVault internal vault;
    address internal user = address(0xA1);
    bytes32 internal fluidKey;

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);

        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        vault.registerProtocol("Fluid", FLUID_FUSDC, true);
        fluidKey = keccak256(bytes("Fluid"));
    }

    function test_fork_fluid_deposit() public {
        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(fluidKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        uint256 shares = IERC4626(FLUID_FUSDC).balanceOf(user);
        assertGt(shares, 0, "User should have fUSDC shares");
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
    }

    function test_fork_fluid_depositAndWithdraw() public {
        uint256 amount = 500e6;
        deal(USDC, user, amount);

        // Deposit
        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory dEntries = new FortVault.DepositEntry[](1);
        dEntries[0] = FortVault.DepositEntry(fluidKey, amount, 0, "");
        vault.deposit(dEntries);

        // Withdraw
        uint256 shares = IERC4626(FLUID_FUSDC).balanceOf(user);
        IERC4626(FLUID_FUSDC).approve(address(vault), shares);

        FortVault.WithdrawEntry[] memory wEntries = new FortVault.WithdrawEntry[](1);
        wEntries[0] = FortVault.WithdrawEntry(fluidKey, shares, 0, "");
        vault.withdraw(wEntries);
        vm.stopPrank();

        uint256 usdcBack = IERC20(USDC).balanceOf(user);
        assertApproxEqAbs(usdcBack, amount, 2, "Should get ~same USDC back");
        assertEq(IERC4626(FLUID_FUSDC).balanceOf(user), 0, "Should have zero shares");
    }

    function test_fork_fluid_assetIsUsdc() public {
        assertEq(IERC4626(FLUID_FUSDC).asset(), USDC, "Fluid vault asset should be USDC");
    }

    function test_fork_fluid_largeDeposit() public {
        uint256 amount = 1_000_000e6; // 1M USDC
        deal(USDC, user, amount);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(fluidKey, amount, 0, "");
        vault.deposit(entries);
        vm.stopPrank();

        assertGt(IERC4626(FLUID_FUSDC).balanceOf(user), 0);
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0);
    }
}
