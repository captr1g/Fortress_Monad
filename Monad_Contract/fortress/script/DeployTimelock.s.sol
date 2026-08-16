// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title DeployTimelock — deploy OZ TimelockController for FORTRESS governance
/// @notice Deploys TimelockController with 48h delay, self-governed (admin = address(0)).
///         After deployment, transfer ownership of all contracts to this timelock.
///
///         Usage:
///           1. Deploy this script
///           2. For each contract: deployer calls transferOwnership(timelock)
///           3. Schedule acceptOwnership() through timelock for each contract
///           4. After 48h: execute all acceptOwnership() calls
contract DeployTimelock is Script {
    uint256 constant MIN_DELAY = 48 hours;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);

        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPk);

        // Proposers and executors = deployer (will be multisig in production)
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;

        address[] memory executors = new address[](1);
        executors[0] = deployer;

        // admin = address(0) → self-governed, no external admin
        TimelockController timelock = new TimelockController(MIN_DELAY, proposers, executors, address(0));

        vm.stopBroadcast();

        console.log("=== TimelockController Deployed ===");
        console.log("TimelockController:", address(timelock));
        console.log("Min delay:", MIN_DELAY);
        console.log("Proposer:", deployer);
        console.log("Executor:", deployer);
        console.log("Admin: self-governed (address(0))");
        console.log("");
        console.log("Next steps:");
        console.log("  1. For each contract: call transferOwnership(timelock)");
        console.log("  2. Schedule acceptOwnership() through timelock");
        console.log("  3. After 48h: execute acceptOwnership() calls");
    }
}
