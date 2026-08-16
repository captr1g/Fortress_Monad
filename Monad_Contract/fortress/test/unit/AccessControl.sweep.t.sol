// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/adapters/AaveV3Adapter.sol";
import "../../src/adapters/ShMonadAdapter.sol";
import "../../src/config/MonadAddresses.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockLiFiDiamond.sol";
import "../mocks/MockAaveV3.sol";
import "../mocks/MockShMonad.sol";

/// @title Access-control sweep across every Phase 4 adapter (Phase 8 slice)
///
/// @notice One place that asserts the two gates every adapter must hold, for every
///         adapter, so a new one cannot be added with a gate quietly missing.
///
/// @dev Slither is not installed in this environment, so the security pass is
///      expressed as executable assertions rather than a scan report. These are the
///      properties a scanner would flag the absence of, and they are worth more as
///      tests: a scanner tells you a modifier is missing today, a test tells you the
///      day someone removes one.
///
///      Two gates, and they are NOT interchangeable:
///
///        - `onlyOwner`  — configuration and the UUPS upgrade key. Whoever holds it
///          can replace the implementation behind the proxy.
///        - `onlyVault`  — the value-moving entry points. These pull tokens from
///          third parties via allowances the vault holds, so an unguarded one is
///          drainable by anyone.
///
///      `_authorizeUpgrade` is covered too: it is the single most dangerous function
///      in the system and it is reachable through `upgradeToAndCall`.
contract AccessControlSweepTest is Test {
    LiFiAdapter internal lifi;
    AaveV3Adapter internal aave;
    ShMonadAdapter internal shmon;

    MockUSDC internal usdc;
    MockLiFiDiamond internal diamond;
    MockAavePool internal pool;
    MockShMonad internal shMonad;

    address internal owner = address(this);
    address internal vault = address(0xBA);
    address internal stranger = address(0xBAD);

    bytes4 internal constant OWNABLE_UNAUTHORIZED = bytes4(keccak256("OwnableUnauthorizedAccount(address)"));

    function setUp() public {
        usdc = new MockUSDC();
        diamond = new MockLiFiDiamond(1e6);
        pool = new MockAavePool(address(usdc), 6);
        shMonad = new MockShMonad(0.5e18, 65);

        LiFiAdapter lifiImpl = new LiFiAdapter(address(usdc), address(diamond));
        lifi = LiFiAdapter(
            payable(address(
                    new ERC1967Proxy(address(lifiImpl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)))
                ))
        );

        AaveV3Adapter aaveImpl = new AaveV3Adapter(address(usdc), address(pool), address(pool.aToken()));
        aave = AaveV3Adapter(
            address(new ERC1967Proxy(address(aaveImpl), abi.encodeCall(AaveV3Adapter.initialize, (owner, vault))))
        );

        ShMonadAdapter shmonImpl = new ShMonadAdapter(address(usdc), address(shMonad), address(lifi));
        shmon = ShMonadAdapter(
            payable(address(
                    new ERC1967Proxy(address(shmonImpl), abi.encodeCall(ShMonadAdapter.initialize, (owner, vault)))
                ))
        );
    }

    function _expectNotOwner() internal {
        vm.expectRevert(abi.encodeWithSelector(OWNABLE_UNAUTHORIZED, stranger));
    }

    /*//////////////////////////////////////////////////////////////
                          onlyOwner — CONFIGURATION
    //////////////////////////////////////////////////////////////*/

    function test_lifi_ownerGates() public {
        vm.startPrank(stranger);
        _expectNotOwner();
        lifi.setApprovedDex(address(0xDE), true);
        _expectNotOwner();
        lifi.setApprovedSwapSelector(bytes4(0x12345678), true);
        _expectNotOwner();
        lifi.setVault(stranger);
        _expectNotOwner();
        lifi.rescueToken(address(usdc), stranger, 0);
        _expectNotOwner();
        lifi.rescueNative(stranger, 0);
        vm.stopPrank();
    }

    function test_aave_ownerGates() public {
        vm.startPrank(stranger);
        _expectNotOwner();
        aave.setVault(stranger);
        _expectNotOwner();
        aave.rescueToken(address(usdc), stranger, 0);
        vm.stopPrank();
    }

    function test_shmonad_ownerGates() public {
        vm.startPrank(stranger);
        _expectNotOwner();
        shmon.setVault(stranger);
        _expectNotOwner();
        shmon.rescueToken(address(usdc), stranger, 0);
        _expectNotOwner();
        shmon.rescueNative(stranger, 0);
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    onlyVault — THE VALUE-MOVING ENTRY POINTS
    //////////////////////////////////////////////////////////////*/

    /// @notice These pull tokens from third parties using allowances the vault holds.
    ///         An unguarded one is drainable by anyone, which is why each is asserted
    ///         individually rather than assumed from the modifier's presence.
    function test_valueMovingEntryPoints_areVaultGated() public {
        vm.startPrank(stranger);

        vm.expectRevert(LiFiAdapter.OnlyVault.selector);
        lifi.depositFor(1e6, stranger, "");
        vm.expectRevert(LiFiAdapter.OnlyVault.selector);
        lifi.redeemFor(1e6, stranger, stranger, "");
        vm.expectRevert(LiFiAdapter.OnlyVault.selector);
        lifi.redeemFor(1e6, stranger, stranger);

        vm.expectRevert(AaveV3Adapter.OnlyVault.selector);
        aave.depositFor(1e6, stranger);
        vm.expectRevert(AaveV3Adapter.OnlyVault.selector);
        aave.redeemFor(1e6, stranger, stranger);

        vm.expectRevert(ShMonadAdapter.OnlyVault.selector);
        shmon.depositFor(1e6, stranger, "");
        vm.expectRevert(ShMonadAdapter.OnlyVault.selector);
        shmon.redeemFor(1e6, stranger, stranger, "");
        vm.expectRevert(ShMonadAdapter.OnlyVault.selector);
        shmon.redeemFor(1e6, stranger, stranger);

        vm.stopPrank();
    }

    /// @notice `LiFiAdapter.swap` is deliberately NOT vault-gated — it is the public
    ///         user-facing entry point. Recorded so its openness reads as a decision
    ///         rather than an oversight next to the gated functions above.
    function test_lifi_swap_isIntentionallyPublic() public {
        LibSwap.SwapData[] memory route = new LibSwap.SwapData[](1);
        route[0] = LibSwap.SwapData({
            callTo: address(0xDE),
            approveTo: address(0xDE),
            sendingAssetId: address(usdc),
            receivingAssetId: address(0xEE),
            fromAmount: 1e6,
            callData: abi.encodePacked(bytes4(0x11111111)),
            requiresDeposit: true
        });

        // Reaches validation and is refused on the allowlist, NOT on the caller.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedCallTo.selector, address(0xDE)));
        lifi.swap(address(usdc), 1e6, address(0xEE), 0, type(uint256).max, 0, route);
    }

    /*//////////////////////////////////////////////////////////////
                      THE UPGRADE KEY — most dangerous
    //////////////////////////////////////////////////////////////*/

    /// @notice `_authorizeUpgrade` is `onlyOwner` on every proxy. A stranger able to
    ///         reach it could replace the implementation and drain everything.
    function test_upgradeIsOwnerGated() public {
        // Deployed BEFORE arming the cheatcode: a `new` expression is itself a call,
        // and expectRevert applies to the very next one.
        address newLifi = address(new LiFiAdapter(address(usdc), address(diamond)));
        address newAave = address(new AaveV3Adapter(address(usdc), address(pool), address(pool.aToken())));
        address newShmon = address(new ShMonadAdapter(address(usdc), address(shMonad), address(lifi)));

        vm.startPrank(stranger);
        _expectNotOwner();
        lifi.upgradeToAndCall(newLifi, "");
        _expectNotOwner();
        aave.upgradeToAndCall(newAave, "");
        _expectNotOwner();
        shmon.upgradeToAndCall(newShmon, "");
        vm.stopPrank();
    }

    /*//////////////////////////////////////////////////////////////
                    Ownable2Step — the handover cannot slip
    //////////////////////////////////////////////////////////////*/

    /// @notice Every adapter is `Ownable2Step`, so a transfer to a wrong address is
    ///         a no-op rather than a permanent loss of the upgrade key. Phase 7's
    ///         handover depends on this being true of all of them.
    function test_ownershipTransferIsTwoStep() public {
        address newOwner = address(0xC0FFEE);

        lifi.transferOwnership(newOwner);
        aave.transferOwnership(newOwner);
        shmon.transferOwnership(newOwner);

        // Transfer started, but nothing has moved yet.
        assertEq(lifi.owner(), owner, "LiFi owner unchanged until accepted");
        assertEq(aave.owner(), owner, "Aave owner unchanged until accepted");
        assertEq(shmon.owner(), owner, "shMonad owner unchanged until accepted");
        assertEq(lifi.pendingOwner(), newOwner);

        // Only the pending owner can complete it.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OWNABLE_UNAUTHORIZED, stranger));
        lifi.acceptOwnership();

        vm.startPrank(newOwner);
        lifi.acceptOwnership();
        aave.acceptOwnership();
        shmon.acceptOwnership();
        vm.stopPrank();

        assertEq(lifi.owner(), newOwner);
        assertEq(aave.owner(), newOwner);
        assertEq(shmon.owner(), newOwner);

        // And the old owner is now powerless.
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OWNABLE_UNAUTHORIZED, owner));
        lifi.setApprovedDex(address(0xDE), true);
    }

    /*//////////////////////////////////////////////////////////////
                          INITIALIZER LOCKDOWN
    //////////////////////////////////////////////////////////////*/

    /// @notice Implementations must be locked, or an attacker can initialize the
    ///         logic contract directly and, on a UUPS proxy, use it to self-destruct
    ///         or hijack the upgrade path.
    function test_implementationsCannotBeInitialized() public {
        LiFiAdapter lifiImpl = new LiFiAdapter(address(usdc), address(diamond));
        AaveV3Adapter aaveImpl = new AaveV3Adapter(address(usdc), address(pool), address(pool.aToken()));
        ShMonadAdapter shmonImpl = new ShMonadAdapter(address(usdc), address(shMonad), address(lifi));

        bytes4 alreadyInit = bytes4(keccak256("InvalidInitialization()"));

        vm.expectRevert(alreadyInit);
        lifiImpl.initialize(stranger, stranger);
        vm.expectRevert(alreadyInit);
        aaveImpl.initialize(stranger, stranger);
        vm.expectRevert(alreadyInit);
        shmonImpl.initialize(stranger, stranger);
    }

    /// @notice A proxy cannot be re-initialized to hand control to someone else.
    function test_proxiesCannotBeReinitialized() public {
        bytes4 alreadyInit = bytes4(keccak256("InvalidInitialization()"));

        vm.startPrank(stranger);
        vm.expectRevert(alreadyInit);
        lifi.initialize(stranger, stranger);
        vm.expectRevert(alreadyInit);
        aave.initialize(stranger, stranger);
        vm.expectRevert(alreadyInit);
        shmon.initialize(stranger, stranger);
        vm.stopPrank();
    }
}
