// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/FortVault.sol";
import "../../src/adapters/AerodromeAdapter.sol";
import "../../src/interfaces/IAerodromeGauge.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork test for AerodromeAdapter on Base mainnet.
///         Requires BASE_RPC_URL + AERO_POOL, AERO_GAUGE, AERO_PAIRED_TOKEN env vars.
contract AerodromeForkTest is Test {
    // Base mainnet addresses
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant AERO_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERO_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    FortVault internal vault;
    AerodromeAdapter internal adapter;
    address internal user = address(0xA1);
    bytes32 internal aeroKey;

    // Env-var driven pool config
    address internal aeroPool;
    address internal aeroGauge;
    address internal pairedToken;

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // Read pool config from env
        aeroPool = vm.envOr("AERO_POOL", address(0));
        aeroGauge = vm.envOr("AERO_GAUGE", address(0));
        pairedToken = vm.envOr("AERO_PAIRED_TOKEN", address(0));

        // Deploy vault
        FortVault impl = new FortVault();
        bytes memory initData = abi.encodeCall(FortVault.initialize, (USDC));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = FortVault(address(proxy));

        // Deploy adapter
        AerodromeAdapter adapterImpl = new AerodromeAdapter(USDC, AERO_ROUTER, AERO_FACTORY);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl),
            abi.encodeCall(AerodromeAdapter.initialize, (address(this), address(vault)))
        );
        adapter = AerodromeAdapter(address(adapterProxy));

        // Configure pool if env vars set
        if (aeroPool != address(0) && aeroGauge != address(0) && pairedToken != address(0)) {
            adapter.addPool("USDC-PAIRED", aeroPool, aeroGauge, pairedToken, false);
        }

        // Register
        vault.registerProtocol("Aerodrome", address(adapter), false);
        aeroKey = keccak256(bytes("Aerodrome"));
    }

    function test_fork_aerodrome_deposit() public {
        if (aeroPool == address(0)) {
            emit log("SKIPPED: AERO_POOL env var not set");
            return;
        }

        uint256 amount = 1000e6; // 1000 USDC
        deal(USDC, user, amount);

        bytes32 poolKey = keccak256(bytes("USDC-PAIRED"));
        bytes memory data = abi.encode(
            poolKey,
            uint256(0),     // minPairedOut
            uint256(0),     // amountAMin
            uint256(0),     // amountBMin
            block.timestamp + 300
        );

        vm.startPrank(user);
        IERC20(USDC).approve(address(vault), amount);

        FortVault.DepositEntry[] memory entries = new FortVault.DepositEntry[](1);
        entries[0] = FortVault.DepositEntry(aeroKey, amount, 0, data);
        vault.deposit(entries);
        vm.stopPrank();

        // User should have gauge tokens
        uint256 gaugeBalance = IAerodromeGauge(aeroGauge).balanceOf(user);
        assertGt(gaugeBalance, 0, "User should have gauge tokens");

        // Adapter + vault should hold nothing
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0, "Vault should hold zero USDC");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "Adapter should hold zero USDC");
    }

    function test_fork_aerodrome_adapterDeploy() public {
        assertEq(address(adapter.usdc()), USDC);
        assertEq(address(adapter.router()), AERO_ROUTER);
        assertEq(adapter.factory(), AERO_FACTORY);
    }
}
