// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";

/// @title MonadFork — single source of truth for fork-test pinning
/// @notice Every fork test forks Monad mainnet at ONE pinned block, so results are
///         reproducible and reviewable.
///
/// @dev Why pinned: port prompt §2 warns that Monad full-node historical state is
///      throughput-limited and that forking at an arbitrary old block may not be
///      possible. Phase 2 confirmed state IS queryable at the block below
///      (`USDC.decimals()` → 6 at that height), but the usable window moves
///      forward over time. If these tests start failing with missing state,
///      re-pin to a recent block and record the change here and in RESEARCH.md.
abstract contract MonadFork is Test {
    /// @notice Monad mainnet, chain ID 143.
    uint256 internal constant MONAD_CHAIN_ID = 143;

    /// @notice Pinned fork block. Verified queryable 2026-08-16.
    ///         timestamp 1786865553, gasLimit 150,000,000.
    uint256 internal constant FORK_BLOCK = 96_431_000;

    /// @notice Forks Monad mainnet at the pinned block and asserts the chain is right.
    function _forkMonad() internal {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);
        require(block.chainid == MONAD_CHAIN_ID, "MonadFork: not Monad mainnet");
    }
}
