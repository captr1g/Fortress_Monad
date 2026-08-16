// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "../src/FortVault.sol";
import "../src/FortStrategyExecutor.sol";
import "../src/adapters/LiFiAdapter.sol";
import "../src/adapters/AaveV3Adapter.sol";
import "../src/adapters/ShMonadAdapter.sol";
import "../src/config/MonadAddresses.sol";

/// @title VerifyDeployment — post-deploy assertions (Phase 9)
///
/// @notice Read-only. Never broadcasts, so it is safe to run against mainnet with no
///         key. Run it after `DeployMonad`, after `TransferOwnership`, and again
///         before anyone is told the deployment is live.
///
/// @dev Checks what a deployment can silently get wrong:
///
///        1. **Reserved adapter slots are still empty.** `PENDING.md` keeps ids
///           3/4/5 for eventual Compound V3 / Aerodrome / YO replacements and
///           forbids substitutes. A registration there is a policy breach, not a
///           bug, and nothing else in the system would notice.
///        2. **Every third-party address matches the verified address book.** A
///           proxy wired to the wrong pool or diamond behaves normally right up to
///           the point where it does not.
///        3. **Ownership actually reached the timelock.** `Ownable2Step` means
///           `transferOwnership` alone changes nothing; if the accept step was
///           skipped, the deployer still controls every UUPS upgrade.
///        4. **The I5 selector allowlist is populated.** It ships empty and fails
///           closed, so a deployment that skipped it has dead swap paths.
///
///      Usage (no key needed):
///        FORT_VAULT=0x.. LIFI_ADAPTER=0x.. TIMELOCK=0x.. \
///        forge script script/VerifyDeployment.s.sol --rpc-url monad
contract VerifyDeployment is Script {
    uint256 internal failures;
    uint256 internal warnings;

    function run() external {
        require(
            block.chainid == MonadAddresses.CHAIN_ID || block.chainid == MonadAddresses.TESTNET_CHAIN_ID, "not Monad"
        );
        console.log("Chain:", block.chainid);
        console.log("");

        _checkVaultRegistry();
        _checkAdapterWiring();
        _checkReservedSlots();
        _checkOwnership();
        _checkSelectorAllowlist();

        console.log("");
        console.log("=====================================");
        if (failures > 0) {
            console.log("FAILURES:", failures);
            revert("VerifyDeployment: deployment is NOT correct");
        }
        console.log("All checks passed.");
        if (warnings > 0) {
            console.log("WARNINGS:", warnings);
            console.log("Deployment is wired correctly but NOT fully operational.");
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 CHECKS
    //////////////////////////////////////////////////////////////*/

    function _checkVaultRegistry() internal {
        address vaultAddr = vm.envOr("FORT_VAULT", address(0));
        if (vaultAddr == address(0)) return _skip("FORT_VAULT unset - registry checks skipped");

        FortVault vault = FortVault(vaultAddr);
        console.log("--- vault registry ---");

        // Registered under an adapter (isERC4626 = false).
        _expectProtocol(vault, "LiFi", vm.envOr("LIFI_ADAPTER", address(0)), false);
        _expectProtocol(vault, "Aave", vm.envOr("AAVE_ADAPTER", address(0)), false);
        _expectProtocol(vault, "Neverland", vm.envOr("NEVERLAND_ADAPTER", address(0)), false);
        _expectProtocol(vault, "shMONAD", vm.envOr("SHMONAD_ADAPTER", address(0)), false);

        // Native ERC-4626, driven by the vault's fast path.
        _expectProtocol(vault, "Curvance", MonadAddresses.CURVANCE_CUSDC, true);
        _expectProtocol(vault, "Euler", MonadAddresses.EULER_EVAULT_USDC, true);
        _expectProtocol(vault, "Morpho", MonadAddresses.VAULT_HYPERITHM_USDC_APEX, true);

        // Base keys that must NOT exist on Monad. Compound and Yearn have no
        // counterparty here; registering one would mean a substitute was slipped in.
        _expectNoProtocol(vault, "Compound");
        _expectNoProtocol(vault, "Yearn");
    }

    function _checkAdapterWiring() internal {
        console.log("");
        console.log("--- adapter wiring vs the verified address book ---");

        address lifi = vm.envOr("LIFI_ADAPTER", address(0));
        if (lifi != address(0)) {
            _eq("LiFiAdapter.lifiDiamond", LiFiAdapter(payable(lifi)).lifiDiamond(), MonadAddresses.LIFI_DIAMOND);
            _eq("LiFiAdapter.usdc", address(LiFiAdapter(payable(lifi)).usdc()), MonadAddresses.USDC);
        }

        address aave = vm.envOr("AAVE_ADAPTER", address(0));
        if (aave != address(0)) {
            _eq("AaveAdapter.pool", address(AaveV3Adapter(aave).pool()), MonadAddresses.AAVE_V3_POOL);
            _eq("AaveAdapter.aToken", address(AaveV3Adapter(aave).aToken()), MonadAddresses.AAVE_V3_A_USDC);
        }

        address nev = vm.envOr("NEVERLAND_ADAPTER", address(0));
        if (nev != address(0)) {
            _eq("NeverlandAdapter.pool", address(AaveV3Adapter(nev).pool()), MonadAddresses.NEVERLAND_POOL);
            _eq("NeverlandAdapter.aToken", address(AaveV3Adapter(nev).aToken()), MonadAddresses.NEVERLAND_A_USDC);
        }

        address shmon = vm.envOr("SHMONAD_ADAPTER", address(0));
        if (shmon != address(0)) {
            _eq("ShMonadAdapter.shMonad", address(ShMonadAdapter(payable(shmon)).shMonad()), MonadAddresses.SHMONAD);
            // The MON leg must route through the deployed LiFiAdapter, not some
            // other swapper — that is what keeps I5 to a single allowlist.
            if (lifi != address(0)) {
                _eq("ShMonadAdapter.swapper", address(ShMonadAdapter(payable(shmon)).swapper()), lifi);
            }
        }
    }

    /// @dev PENDING.md: ids 3/4/5 are reserved and must stay empty. Nothing else in
    ///      the system enforces this, which is exactly why it is checked here.
    function _checkReservedSlots() internal {
        console.log("");
        console.log("--- reserved adapter slots (PENDING.md) ---");

        address execAddr = vm.envOr("FORT_STRATEGY_EXECUTOR", address(0));
        if (execAddr == address(0)) return _skip("FORT_STRATEGY_EXECUTOR unset - slot checks skipped");

        FortStrategyExecutor exec = FortStrategyExecutor(execAddr);
        for (uint8 id = 3; id <= 5; id++) {
            address filled = exec.adapters(id);
            if (filled == address(0)) {
                console.log("  OK   slot reserved and empty:", id);
            } else {
                console.log("  FAIL slot must be EMPTY, id:", id);
                console.log("       registered:", filled);
                failures++;
            }
        }
    }

    function _checkOwnership() internal {
        console.log("");
        console.log("--- ownership handover (Phase 7) ---");

        address timelock = vm.envOr("TIMELOCK", address(0));
        if (timelock == address(0)) return _skip("TIMELOCK unset - ownership checks skipped");

        string[8] memory keys = [
            "FORT_VAULT",
            "LIFI_ADAPTER",
            "FORT_SWAP_ROUTER",
            "CROSS_CHAIN_ROUTER",
            "AAVE_ADAPTER",
            "NEVERLAND_ADAPTER",
            "SHMONAD_ADAPTER",
            "FORT_STRATEGY_EXECUTOR"
        ];

        for (uint256 i; i < keys.length; i++) {
            address target = vm.envOr(keys[i], address(0));
            if (target == address(0)) continue;

            Ownable2StepUpgradeable c = Ownable2StepUpgradeable(target);
            address currentOwner = c.owner();

            if (currentOwner == timelock) {
                console.log("  OK   owned by timelock:", keys[i]);
            } else if (c.pendingOwner() == timelock) {
                // The dangerous middle state: transfer started, accept never ran, so
                // the deployer still holds the upgrade key.
                console.log("  FAIL handover INCOMPLETE:", keys[i]);
                console.log("       still owned by:", currentOwner);
                failures++;
            } else {
                console.log("  FAIL not handed over at all:", keys[i]);
                console.log("       owner:", currentOwner);
                failures++;
            }
        }
    }

    /// @dev The selector allowlist ships empty and fails closed (DECISIONS.md D4-3).
    ///      An empty allowlist is a correct deployment with dead swap paths, so this
    ///      is a WARNING, not a failure — but it must never pass silently.
    function _checkSelectorAllowlist() internal {
        console.log("");
        console.log("--- I5 selector allowlist ---");

        address lifi = vm.envOr("LIFI_ADAPTER", address(0));
        if (lifi == address(0)) return _skip("LIFI_ADAPTER unset - allowlist check skipped");

        // A deployment cannot enumerate a mapping, so this probes the selectors the
        // operator is expected to have allowlisted, supplied as a comma-free env var.
        bytes4 probe = bytes4(uint32(vm.envOr("PROBE_SELECTOR", uint256(0))));
        if (probe == bytes4(0)) {
            console.log("  WARN PROBE_SELECTOR unset - cannot confirm the allowlist");
            console.log("       Swap paths revert UnauthorizedSelector until populated.");
            warnings++;
            return;
        }

        if (LiFiAdapter(payable(lifi)).isApprovedSwapSelector(probe)) {
            console.log("  OK   probe selector is allowlisted");
        } else {
            console.log("  WARN probe selector NOT allowlisted - swap paths are dead");
            warnings++;
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 HELPERS
    //////////////////////////////////////////////////////////////*/

    function _expectProtocol(FortVault vault, string memory name, address expected, bool expectErc4626) internal {
        if (expected == address(0)) {
            console.log("  SKIP (address unset):", name);
            return;
        }
        (address addr, bool isErc4626) = vault.protocols(keccak256(bytes(name)));
        if (addr != expected) {
            console.log("  FAIL registry mismatch:", name);
            console.log("       got:", addr);
            console.log("       want:", expected);
            failures++;
            return;
        }
        if (isErc4626 != expectErc4626) {
            console.log("  FAIL isERC4626 flag wrong for:", name);
            failures++;
            return;
        }
        console.log("  OK  ", name);
    }

    function _expectNoProtocol(FortVault vault, string memory name) internal {
        (address addr,) = vault.protocols(keccak256(bytes(name)));
        if (addr != address(0)) {
            console.log("  FAIL key must NOT be registered on Monad:", name);
            console.log("       registered:", addr);
            failures++;
        } else {
            console.log("  OK   absent as expected:", name);
        }
    }

    function _eq(string memory what, address got, address want) internal {
        if (got == want) {
            console.log("  OK  ", what);
        } else {
            console.log("  FAIL", what);
            console.log("       got:", got);
            console.log("       want:", want);
            failures++;
        }
    }

    function _skip(string memory msg_) internal pure {
        console.log("  SKIP", msg_);
    }
}
