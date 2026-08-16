// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/interfaces/ILiFi.sol";
import "../../src/config/MonadAddresses.sol";
import "../helpers/MonadFork.sol";

/// @title LI.FI fork tests — pins DECISIONS.md D0-5 to the live Monad diamond
///
/// @notice Phase 4. The Base fixtures this file used to carry (USDC
///         `0x833589fC…`, diamond `0x1231DEB6…`) are gone; neither has code on
///         Monad, and the second one was the whole reason the adapter needed a
///         rewrite rather than a re-point.
///
/// @dev The central claim of D0-5 is a fact about the deployed diamond's selector
///      table, so it is asserted against that table rather than restated in prose:
///
///        - `swapTokensGeneric` (0x4630a0d8) — the only function the Base
///          `ILiFi.sol` declared — resolves to `address(0)`. The diamond does not
///          register it. Every Base-era swap path reverted here.
///        - All six GenericSwapFacetV3 selectors resolve to one facet, and that
///          facet is the address recorded as `LIFI_GENERIC_SWAP_FACET_V3`.
///
///      If LI.FI ever re-adds the v1 facet or moves the V3 one, this fails loudly
///      instead of the adapter failing quietly in production.
///
///      Excluded from the default CI run (`--no-match-path "test/fork/*"`); needs
///      `MONAD_RPC_URL`.
contract FortVaultLiFiForkTest is Test, MonadFork {
    /// @dev Every V3 selector, in `LibLiFi.SwapKind` ordinal order.
    bytes4[6] internal V3_SELECTORS = [
        MonadAddresses.LIFI_SWAP_SINGLE_ERC20_TO_ERC20,
        MonadAddresses.LIFI_SWAP_SINGLE_ERC20_TO_NATIVE,
        MonadAddresses.LIFI_SWAP_SINGLE_NATIVE_TO_ERC20,
        MonadAddresses.LIFI_SWAP_MULTIPLE_ERC20_TO_ERC20,
        MonadAddresses.LIFI_SWAP_MULTIPLE_ERC20_TO_NATIVE,
        MonadAddresses.LIFI_SWAP_MULTIPLE_NATIVE_TO_ERC20
    ];

    /// @dev The v1 selector the Base adapter called.
    bytes4 internal constant SWAP_TOKENS_GENERIC = 0x4630a0d8;

    LiFiAdapter internal adapter;
    ILiFiDiamondLoupe internal loupe;

    address internal owner = address(this);
    address internal vault = address(0xBA);

    function setUp() public {
        _forkMonad();
        loupe = ILiFiDiamondLoupe(MonadAddresses.LIFI_DIAMOND);

        LiFiAdapter impl = new LiFiAdapter(MonadAddresses.USDC, MonadAddresses.LIFI_DIAMOND);
        adapter = LiFiAdapter(
            payable(address(new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, vault)))))
        );
    }

    /*//////////////////////////////////////////////////////////////
                              D0-5 EVIDENCE
    //////////////////////////////////////////////////////////////*/

    /// @notice The Monad diamond is a real contract at the recorded address.
    function test_fork_lifi_diamondHasCode() public view {
        assertGt(MonadAddresses.LIFI_DIAMOND.code.length, 0, "LI.FI diamond has no code on Monad");
    }

    /// @notice The load-bearing negative result: the v1 entry point does not exist.
    function test_fork_lifi_swapTokensGenericIsNotRegistered() public view {
        assertEq(
            loupe.facetAddress(SWAP_TOKENS_GENERIC),
            address(0),
            "swapTokensGeneric is registered again - re-check the adapter's dispatch"
        );
    }

    /// @notice Every variant the adapter can dispatch to is live, on one facet.
    function test_fork_lifi_allV3SelectorsRoutedToRecordedFacet() public view {
        for (uint256 i; i < V3_SELECTORS.length; ++i) {
            assertEq(
                loupe.facetAddress(V3_SELECTORS[i]),
                MonadAddresses.LIFI_GENERIC_SWAP_FACET_V3,
                "V3 selector not routed to the recorded GenericSwapFacetV3"
            );
        }
    }

    /// @notice The recorded facet address is a deployed contract, not a stale note.
    function test_fork_lifi_genericSwapFacetV3HasCode() public view {
        assertGt(MonadAddresses.LIFI_GENERIC_SWAP_FACET_V3.code.length, 0);
    }

    /*//////////////////////////////////////////////////////////////
                            ADAPTER WIRING
    //////////////////////////////////////////////////////////////*/

    function test_fork_lifi_adapterDeployed() public view {
        assertEq(address(adapter.usdc()), MonadAddresses.USDC);
        assertEq(adapter.lifiDiamond(), MonadAddresses.LIFI_DIAMOND);
        assertEq(adapter.vault(), vault);
    }

    function test_fork_lifi_depositWithoutData_reverts() public {
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.depositFor(1000e6, address(0xA1));
    }

    function test_fork_lifi_redeemWithoutData_reverts() public {
        vm.prank(vault);
        vm.expectRevert(LiFiAdapter.InvalidData.selector);
        adapter.redeemFor(1000e6, address(0xA1), address(0xA1));
    }

    /// @notice I5 fails closed on a freshly deployed adapter: allowlisting the DEX
    ///         address alone does not open the swap path.
    function test_fork_lifi_selectorAllowlistFailsClosed() public {
        adapter.setApprovedDex(MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2, true);

        bytes4 unlisted = bytes4(keccak256("swap(address,uint256)"));
        LibSwap.SwapData[] memory route = new LibSwap.SwapData[](1);
        route[0] = LibSwap.SwapData({
            callTo: MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2,
            approveTo: MonadAddresses.KYBERSWAP_META_AGGREGATION_ROUTER_V2,
            sendingAssetId: MonadAddresses.USDC,
            receivingAssetId: MonadAddresses.WMON,
            fromAmount: 1000e6,
            callData: abi.encodePacked(unlisted),
            requiresDeposit: true
        });

        bytes memory data = abi.encode(
            uint8(LibLiFi.SwapKind.SingleERC20ToERC20), MonadAddresses.WMON, route, uint256(0), type(uint256).max
        );

        vm.prank(vault);
        vm.expectRevert(abi.encodeWithSelector(LiFiAdapter.UnauthorizedSelector.selector, unlisted));
        adapter.depositFor(1000e6, address(0xA1), data);
    }
}
