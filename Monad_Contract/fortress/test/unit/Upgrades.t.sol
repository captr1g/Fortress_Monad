// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/MorphoLeverageExecutor.sol";
import "../../src/MorphoExitExecutor.sol";
import "../../src/CrossChainRouter.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/adapters/PendleStrategyAdapter.sol";
import "../../src/adapters/LiFiAdapter.sol";
import "../../src/adapters/PendleAdapter.sol";
import "../../src/FortSwapRouter.sol";
import "../mocks/MockUSDC.sol";

contract UpgradesTest is Test {
    address internal owner;
    address internal nonOwner = address(0xBAD);
    MockUSDC internal mockUsdc;

    // All contract instances
    MorphoLeverageExecutor internal lev;
    MorphoExitExecutor internal exit;
    CrossChainRouter internal router;
    MorphoStrategyAdapter internal morphoAdapter;
    SwapStrategyAdapter internal swapAdapter;
    PendleStrategyAdapter internal pendleStrategyAdapter;
    LiFiAdapter internal lifiAdapter;
    PendleAdapter internal pendleAdapter;
    FortSwapRouter internal swapRouter;

    // Shared addresses for constructors
    address internal mockMorpho = address(0x1);
    address internal mockLifi = address(0x2);
    address internal mockFactory = address(0x3);
    address internal mockKeeper = address(0x4);
    address internal mockExecutor = address(0xE);
    address internal mockVault = address(0x5);

    function setUp() public {
        owner = address(this);
        mockUsdc = new MockUSDC();

        // 1. MorphoLeverageExecutor
        {
            MorphoLeverageExecutor impl = new MorphoLeverageExecutor(mockMorpho);
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(MorphoLeverageExecutor.initialize, (owner)));
            lev = MorphoLeverageExecutor(address(proxy));
        }
        // 2. MorphoExitExecutor
        {
            MorphoExitExecutor impl = new MorphoExitExecutor(mockMorpho);
            ERC1967Proxy proxy = new ERC1967Proxy(address(impl), abi.encodeCall(MorphoExitExecutor.initialize, (owner)));
            exit = MorphoExitExecutor(address(proxy));
        }
        // 3. CrossChainRouter
        {
            CrossChainRouter impl = new CrossChainRouter(address(mockUsdc), mockLifi);
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(CrossChainRouter.initialize, (mockKeeper, owner)));
            router = CrossChainRouter(address(proxy));
        }
        // 4. MorphoStrategyAdapter
        {
            MorphoStrategyAdapter impl = new MorphoStrategyAdapter(mockMorpho);
            ERC1967Proxy proxy = new ERC1967Proxy(
                address(impl), abi.encodeCall(MorphoStrategyAdapter.initialize, (mockExecutor, owner))
            );
            morphoAdapter = MorphoStrategyAdapter(address(proxy));
        }
        // 5. SwapStrategyAdapter
        {
            SwapStrategyAdapter impl = new SwapStrategyAdapter();
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(SwapStrategyAdapter.initialize, (mockExecutor, owner)));
            swapAdapter = SwapStrategyAdapter(address(proxy));
        }
        // 6. PendleStrategyAdapter
        {
            PendleStrategyAdapter impl = new PendleStrategyAdapter(mockMorpho);
            ERC1967Proxy proxy = new ERC1967Proxy(
                address(impl), abi.encodeCall(PendleStrategyAdapter.initialize, (mockExecutor, owner))
            );
            pendleStrategyAdapter = PendleStrategyAdapter(address(proxy));
        }
        // 8. LiFiAdapter
        {
            LiFiAdapter impl = new LiFiAdapter(address(mockUsdc), mockLifi);
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(LiFiAdapter.initialize, (owner, mockVault)));
            lifiAdapter = LiFiAdapter(payable(address(proxy)));
        }
        // 9. PendleAdapter
        {
            PendleAdapter impl = new PendleAdapter(address(mockUsdc), mockLifi);
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(PendleAdapter.initialize, (owner, mockVault)));
            pendleAdapter = PendleAdapter(address(proxy));
        }
        // 12. FortSwapRouter
        {
            FortSwapRouter impl = new FortSwapRouter(address(mockUsdc), mockLifi);
            ERC1967Proxy proxy =
                new ERC1967Proxy(address(impl), abi.encodeCall(FortSwapRouter.initialize, (owner, mockVault)));
            swapRouter = FortSwapRouter(address(proxy));
        }
    }

    // ──────────────────────────────────────────────
    // 1. MorphoLeverageExecutor
    // ──────────────────────────────────────────────

    function test_MorphoLeverageExecutor_upgradeToAndCall_nonOwner_reverts() public {
        MorphoLeverageExecutor newImpl = new MorphoLeverageExecutor(mockMorpho);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        lev.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoLeverageExecutor_upgradeToAndCall_owner_succeeds() public {
        MorphoLeverageExecutor newImpl = new MorphoLeverageExecutor(mockMorpho);
        lev.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoLeverageExecutor_doubleInitialize_reverts() public {
        vm.expectRevert();
        lev.initialize(owner);
    }

    // ──────────────────────────────────────────────
    // 2. MorphoExitExecutor
    // ──────────────────────────────────────────────

    function test_MorphoExitExecutor_upgradeToAndCall_nonOwner_reverts() public {
        MorphoExitExecutor newImpl = new MorphoExitExecutor(mockMorpho);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        exit.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoExitExecutor_upgradeToAndCall_owner_succeeds() public {
        MorphoExitExecutor newImpl = new MorphoExitExecutor(mockMorpho);
        exit.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoExitExecutor_doubleInitialize_reverts() public {
        vm.expectRevert();
        exit.initialize(owner);
    }

    // ──────────────────────────────────────────────
    // 3. CrossChainRouter
    // ──────────────────────────────────────────────

    function test_CrossChainRouter_upgradeToAndCall_nonOwner_reverts() public {
        CrossChainRouter newImpl = new CrossChainRouter(address(mockUsdc), mockLifi);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        router.upgradeToAndCall(address(newImpl), "");
    }

    function test_CrossChainRouter_upgradeToAndCall_owner_succeeds() public {
        CrossChainRouter newImpl = new CrossChainRouter(address(mockUsdc), mockLifi);
        router.upgradeToAndCall(address(newImpl), "");
    }

    function test_CrossChainRouter_doubleInitialize_reverts() public {
        vm.expectRevert();
        router.initialize(mockKeeper, owner);
    }

    // ──────────────────────────────────────────────
    // 4. MorphoStrategyAdapter
    // ──────────────────────────────────────────────

    function test_MorphoStrategyAdapter_upgradeToAndCall_nonOwner_reverts() public {
        MorphoStrategyAdapter newImpl = new MorphoStrategyAdapter(mockMorpho);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        morphoAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoStrategyAdapter_upgradeToAndCall_owner_succeeds() public {
        MorphoStrategyAdapter newImpl = new MorphoStrategyAdapter(mockMorpho);
        morphoAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_MorphoStrategyAdapter_doubleInitialize_reverts() public {
        vm.expectRevert();
        morphoAdapter.initialize(mockExecutor, owner);
    }

    // ──────────────────────────────────────────────
    // 5. SwapStrategyAdapter
    // ──────────────────────────────────────────────

    function test_SwapStrategyAdapter_upgradeToAndCall_nonOwner_reverts() public {
        SwapStrategyAdapter newImpl = new SwapStrategyAdapter();
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        swapAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_SwapStrategyAdapter_upgradeToAndCall_owner_succeeds() public {
        SwapStrategyAdapter newImpl = new SwapStrategyAdapter();
        swapAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_SwapStrategyAdapter_doubleInitialize_reverts() public {
        vm.expectRevert();
        swapAdapter.initialize(mockExecutor, owner);
    }

    // ──────────────────────────────────────────────
    // 6. PendleStrategyAdapter
    // ──────────────────────────────────────────────

    function test_PendleStrategyAdapter_upgradeToAndCall_nonOwner_reverts() public {
        PendleStrategyAdapter newImpl = new PendleStrategyAdapter(mockMorpho);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        pendleStrategyAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_PendleStrategyAdapter_upgradeToAndCall_owner_succeeds() public {
        PendleStrategyAdapter newImpl = new PendleStrategyAdapter(mockMorpho);
        pendleStrategyAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_PendleStrategyAdapter_doubleInitialize_reverts() public {
        vm.expectRevert();
        pendleStrategyAdapter.initialize(mockExecutor, owner);
    }

    // ──────────────────────────────────────────────
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 8. LiFiAdapter
    // ──────────────────────────────────────────────

    function test_LiFiAdapter_upgradeToAndCall_nonOwner_reverts() public {
        LiFiAdapter newImpl = new LiFiAdapter(address(mockUsdc), mockLifi);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        lifiAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_LiFiAdapter_upgradeToAndCall_owner_succeeds() public {
        LiFiAdapter newImpl = new LiFiAdapter(address(mockUsdc), mockLifi);
        lifiAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_LiFiAdapter_doubleInitialize_reverts() public {
        vm.expectRevert();
        lifiAdapter.initialize(owner, mockVault);
    }

    // ──────────────────────────────────────────────
    // 9. PendleAdapter
    // ──────────────────────────────────────────────

    function test_PendleAdapter_upgradeToAndCall_nonOwner_reverts() public {
        PendleAdapter newImpl = new PendleAdapter(address(mockUsdc), mockLifi);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        pendleAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_PendleAdapter_upgradeToAndCall_owner_succeeds() public {
        PendleAdapter newImpl = new PendleAdapter(address(mockUsdc), mockLifi);
        pendleAdapter.upgradeToAndCall(address(newImpl), "");
    }

    function test_PendleAdapter_doubleInitialize_reverts() public {
        vm.expectRevert();
        pendleAdapter.initialize(owner, mockVault);
    }

    // ──────────────────────────────────────────────
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // ──────────────────────────────────────────────

    // ──────────────────────────────────────────────
    // 12. FortSwapRouter
    // ──────────────────────────────────────────────

    function test_FortSwapRouter_upgradeToAndCall_nonOwner_reverts() public {
        FortSwapRouter newImpl = new FortSwapRouter(address(mockUsdc), mockLifi);
        vm.prank(nonOwner);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), nonOwner));
        swapRouter.upgradeToAndCall(address(newImpl), "");
    }

    function test_FortSwapRouter_upgradeToAndCall_owner_succeeds() public {
        FortSwapRouter newImpl = new FortSwapRouter(address(mockUsdc), mockLifi);
        swapRouter.upgradeToAndCall(address(newImpl), "");
    }

    function test_FortSwapRouter_doubleInitialize_reverts() public {
        vm.expectRevert();
        swapRouter.initialize(owner, mockVault);
    }
}
