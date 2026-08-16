// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "../../src/adapters/PendleAdapter.sol";
import "../../src/interfaces/IPendleRouter.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../helpers/MonadFork.sol";

/// @notice Fork test for Pendle adapter on Base mainnet.
///         Requires active USDC PT market on Pendle Base.
///         Set PENDLE_MARKET and PENDLE_PT env vars for the target market.
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract PendleForkTest is Test, MonadFork {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant PENDLE_ROUTER = 0x888888893A18Bc1f05efd6d15CABc5F7A5F89b79;

    FortVault internal vault;
    PendleAdapter internal adapter;
    address internal user = address(0xA1);
    bytes32 internal pendleKey;

    // These must be set via env vars for specific market
    address internal pendleMarket;
    address internal ptToken;

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);

        // Read market addresses from env (skips if not set)
        pendleMarket = vm.envOr("PENDLE_MARKET", address(0));
        ptToken = vm.envOr("PENDLE_PT", address(0));

        // Deploy vault
        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        // Deploy adapter
        PendleAdapter adapterImpl = new PendleAdapter(USDC, PENDLE_ROUTER);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl), abi.encodeCall(PendleAdapter.initialize, (address(this), address(vault)))
        );
        adapter = PendleAdapter(address(adapterProxy));

        // Whitelist market if set
        if (pendleMarket != address(0)) {
            adapter.setApprovedMarket(pendleMarket, true);
        }

        // Register
        vault.registerProtocol("Pendle", address(adapter), false);
        pendleKey = keccak256(bytes("Pendle"));
    }

    function test_fork_pendle_deposit() public {
        if (pendleMarket == address(0)) {
            emit log("SKIPPED: PENDLE_MARKET env var not set");
            return;
        }

        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        IPendleRouter.ApproxParams memory guess = IPendleRouter.ApproxParams({
            guessMin: 0, guessMax: type(uint256).max, guessOffchain: 0, maxIteration: 256, eps: 1e15
        });

        bytes memory data = abi.encode(pendleMarket, uint256(0), guess, block.timestamp + 300);

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(pendleKey, amount, 0, data);
        vault.deposit(entries);
        vm.stopPrank();

        if (ptToken != address(0)) {
            uint256 ptBalance = IERC20(ptToken).balanceOf(user);
            assertGt(ptBalance, 0, "User should have PT tokens");
        }

        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
    }

    function test_fork_pendle_adapterDeploy() public {
        // Basic smoke test — adapter deployed and configured
        assertEq(address(adapter.usdc()), USDC);
        assertEq(address(adapter.router()), PENDLE_ROUTER);
    }
}
