// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";

contract Slots {
    function coldReads(uint256 n) external view returns (uint256 acc) {
        assembly {
            for { let i := 0 } lt(i, n) { i := add(i, 1) } { acc := add(acc, sload(i)) }
        }
    }
}

/// @notice Decides whether the ACTIVE toolchain prices cold SLOAD at Monad's 8,100
///         or Ethereum's 2,100. Phase 0 measured 8,300 marginal against the live
///         Monad RPC and 2,165 against upstream anvil.
contract ColdSloadPricingTest is Test {
    function test_reportMarginalColdSloadCost() public {
        uint256 g10 = _measure(10);
        uint256 g30 = _measure(30);
        uint256 marginal = (g30 - g10) / 20;

        console.log("gas @10 cold SLOADs :", g10);
        console.log("gas @30 cold SLOADs :", g30);
        console.log("marginal per cold SLOAD:", marginal);
        console.log("  Monad schedule = ~8100 | Ethereum schedule = ~2100");
    }

    /// @dev A FRESH contract per measurement, so every slot read is genuinely cold.
    ///      Reusing one instance warms the slots and collapses the marginal cost.
    function _measure(uint256 n) internal returns (uint256) {
        Slots fresh = new Slots();
        uint256 before = gasleft();
        fresh.coldReads(n);
        return before - gasleft();
    }
}
