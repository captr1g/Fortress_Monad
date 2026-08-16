// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/// @title TransferOwnership — hand every FORTRESS contract to the timelock (Phase 7)
///
/// @notice Step 2 of the handover `DeployTimelock.s.sol` describes. Every FORTRESS
///         contract is `Ownable2Step`, so this only STARTS the transfer — the
///         timelock must then call `acceptOwnership()` on each one, which is itself
///         a timelocked action.
///
/// @dev **Two-step is the point, not an inconvenience.** A one-step
///      `transferOwnership` to a wrong or unreachable address is unrecoverable, and
///      the owner here controls `_authorizeUpgrade` on every UUPS proxy — i.e. the
///      right to replace the implementation behind the vault and every adapter. The
///      pending-owner step means a typo is a no-op rather than a permanent loss of
///      the protocol.
///
///      Until the timelock accepts, the deployer remains owner. The handover is not
///      complete on this script alone; `VerifyDeployment.s.sol` is what proves it.
///
///      Usage:
///        FORT_VAULT=0x.. LIFI_ADAPTER=0x.. ... TIMELOCK=0x.. \
///        forge script script/TransferOwnership.s.sol --rpc-url monad --broadcast
contract TransferOwnership is Script {
    /// @dev Every contract named here must be `Ownable2Step`. Adding a one-step
    ///      `Ownable` contract to this list would complete its transfer immediately
    ///      and skip the safety the rest of the flow depends on.
    string[8] internal ENV_KEYS = [
        "FORT_VAULT",
        "LIFI_ADAPTER",
        "FORT_SWAP_ROUTER",
        "CROSS_CHAIN_ROUTER",
        "AAVE_ADAPTER",
        "NEVERLAND_ADAPTER",
        "SHMONAD_ADAPTER",
        "FORT_STRATEGY_EXECUTOR"
    ];

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address timelock = vm.envAddress("TIMELOCK");
        require(timelock != address(0), "TIMELOCK unset");
        require(timelock.code.length > 0, "TIMELOCK has no code");

        console.log("Timelock:", timelock);
        console.log("Deployer:", vm.addr(deployerPk));
        console.log("");

        vm.startBroadcast(deployerPk);

        uint256 started;
        for (uint256 i; i < ENV_KEYS.length; i++) {
            // Contracts not deployed in a given environment are skipped rather than
            // failing the run — the adapter set is deliberately not fixed.
            address target = vm.envOr(ENV_KEYS[i], address(0));
            if (target == address(0)) {
                console.log("SKIP (unset):", ENV_KEYS[i]);
                continue;
            }

            Ownable2StepUpgradeable c = Ownable2StepUpgradeable(target);
            c.transferOwnership(timelock);

            // Assert the pending state rather than assume the call took effect.
            require(c.pendingOwner() == timelock, "pendingOwner not set");
            console.log("PENDING ->", ENV_KEYS[i], target);
            started++;
        }

        vm.stopBroadcast();

        console.log("");
        console.log("Transfers started:", started);
        console.log("");
        console.log("NOT DONE YET. Each contract still has the deployer as owner.");
        console.log("The timelock must now schedule + execute acceptOwnership() on");
        console.log("each address above. Run VerifyDeployment.s.sol afterwards to");
        console.log("confirm the handover actually completed.");
    }
}
