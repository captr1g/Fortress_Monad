// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/AaveV3Adapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockAaveV3.sol";

/// @title AaveV3Adapter gas envelopes (invariant I13, adapter requirement 11)
///
/// @dev Run under Monad Foundry only — `foundryup --network monad`, with
///      `network = "monad"` selecting the Monad opcode schedule. Upstream Foundry
///      under-reports cold-state cost by ~3.85x (DECISIONS.md D0-3).
///
///      Measured against the mock pool, so these bound the part FORTRESS owns:
///      the reserve-state pre-checks, the approval churn, the balance-delta
///      snapshots and the payout. A live Aave supply costs this plus the pool's own
///      index update and aToken mint.
///
///      Envelopes carry ~13% headroom over the measured value.
contract AaveV3AdapterGasTest is Test {
    AaveV3Adapter internal adapter;
    MockUSDC internal usdc;
    MockAavePool internal pool;
    MockAToken internal aToken;

    address internal vault = address(0xBA);
    address internal user = address(0xA1);

    /// @dev Measured under Monad Foundry with `network = "monad"`, cold:
    ///        depositFor           244,997
    ///        redeemFor            108,814  (runs after a deposit, so partly warm)
    ///        availableCapacity     65,555
    ///      Envelopes carry ~13% headroom. Re-measure and re-set if the adapter
    ///      changes; do not widen one to make a failing run pass.
    uint256 internal constant ENVELOPE_DEPOSIT = 277_000;
    uint256 internal constant ENVELOPE_REDEEM = 123_000;
    uint256 internal constant ENVELOPE_CAPACITY_VIEW = 75_000;

    function setUp() public {
        usdc = new MockUSDC();
        pool = new MockAavePool(address(usdc), 6);
        aToken = pool.aToken();

        AaveV3Adapter impl = new AaveV3Adapter(address(usdc), address(pool), address(aToken));
        adapter = AaveV3Adapter(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(AaveV3Adapter.initialize, (address(this), vault))))
        );
        usdc.mint(address(pool), 1_000_000_000e6);
    }

    function test_gas_depositFor() public {
        uint256 amount = 10_000e6;
        usdc.mint(vault, amount);

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 before = gasleft();
        adapter.depositFor(amount, user);
        uint256 used = before - gasleft();
        vm.stopPrank();

        console.log("depositFor gas:", used);
        assertLt(used, ENVELOPE_DEPOSIT, "depositFor exceeded its measured envelope");
    }

    function test_gas_redeemFor() public {
        uint256 amount = 10_000e6;
        usdc.mint(vault, amount);
        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        adapter.depositFor(amount, user);
        vm.stopPrank();

        vm.prank(user);
        aToken.approve(address(adapter), amount);

        vm.prank(vault);
        uint256 before = gasleft();
        adapter.redeemFor(amount, user, user);
        uint256 used = before - gasleft();

        console.log("redeemFor gas:", used);
        assertLt(used, ENVELOPE_REDEEM, "redeemFor exceeded its measured envelope");
    }

    /// @notice `availableCapacity` is read off-chain to size a deposit, so its cost
    ///         is bounded too — a caller that cannot afford the view cannot size.
    function test_gas_availableCapacity() public {
        pool.setConfiguration(MockAaveConfig.build(6, true, false, false, 1_000_000));
        uint256 before = gasleft();
        adapter.availableCapacity();
        uint256 used = before - gasleft();

        console.log("availableCapacity gas:", used);
        assertLt(used, ENVELOPE_CAPACITY_VIEW, "availableCapacity exceeded its envelope");
    }

    /// @notice Records what the reserve-state pre-checks cost, so the choice to keep
    ///         them (attributable reverts instead of Aave's numeric strings) is a
    ///         priced decision rather than an assumed-free one.
    function test_gas_preCheckOverhead() public {
        uint256 amount = 10_000e6;
        usdc.mint(vault, amount * 2);

        uint256 b1 = gasleft();
        adapter.availableCapacity();
        uint256 viewCost = b1 - gasleft();

        vm.startPrank(vault);
        usdc.approve(address(adapter), amount);
        uint256 b2 = gasleft();
        adapter.depositFor(amount, user);
        uint256 depositCost = b2 - gasleft();
        vm.stopPrank();

        console.log("reserve-state read (cold):", viewCost);
        console.log("full depositFor:", depositCost);
    }
}
