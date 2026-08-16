// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/MorphoExitExecutor.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../mocks/MockDex.sol";
import "../helpers/MonadFork.sol";

/// @notice Real Morpho Blue (Base mainnet) test for the flash-loan exit. Validates the
///         two things the mock cannot: the real Morpho flashLoan callback wiring and the
///         real share->asset debt conversion when repaying by shares. The collateral->loan
///         swap leg uses a fork-deployed MockDex funded via `deal` (the real swap calldata
///         is built off-chain by LiFi and is not deterministic in a fork).
interface IMorphoForkExit {
    function idToMarketParams(bytes32 id)
        external
        view
        returns (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv);

    function position(bytes32 id, address user)
        external
        view
        returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);

    function supplyCollateral(
        IMorphoBlue.MarketParams memory marketParams,
        uint256 assets,
        address onBehalf,
        bytes calldata data
    ) external;

    function borrow(
        IMorphoBlue.MarketParams memory marketParams,
        uint256 assets,
        uint256 shares,
        address onBehalf,
        address receiver
    ) external returns (uint256, uint256);

    function setAuthorization(address authorized, bool newIsAuthorized) external;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract MorphoExitExecutorForkTest is Test, MonadFork {
    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    bytes32 constant MARKET_ID = 0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137;

    MorphoExitExecutor internal exit;
    MockDex internal dex;
    IMorphoBlue.MarketParams internal market;

    address internal user = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);

        (address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) =
            IMorphoForkExit(MORPHO_BLUE).idToMarketParams(MARKET_ID);
        market = IMorphoBlue.MarketParams({
            loanToken: loanToken, collateralToken: collateralToken, oracle: oracle, irm: irm, lltv: lltv
        });

        MorphoExitExecutor exitImpl = new MorphoExitExecutor(MORPHO_BLUE);
        ERC1967Proxy exitProxy =
            new ERC1967Proxy(address(exitImpl), abi.encodeCall(MorphoExitExecutor.initialize, (address(this))));
        exit = MorphoExitExecutor(address(exitProxy));
        dex = new MockDex();
        exit.setApprovedDex(address(dex), true);
        exit.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        vm.prank(user);
        IMorphoForkExit(MORPHO_BLUE).setAuthorization(address(exit), true);
    }

    function _openPosition(uint256 collateralAmt, uint256 debtAmt) internal {
        deal(market.collateralToken, user, collateralAmt);
        vm.startPrank(user);
        IERC20(market.collateralToken).approve(MORPHO_BLUE, collateralAmt);
        IMorphoForkExit(MORPHO_BLUE).supplyCollateral(market, collateralAmt, user, "");
        IMorphoForkExit(MORPHO_BLUE).borrow(market, debtAmt, 0, user, user);
        // Move borrowed funds out so exit-proceed assertions are clean.
        IERC20(market.loanToken).transfer(address(0xdead), IERC20(market.loanToken).balanceOf(user));
        vm.stopPrank();
    }

    function test_fork_fullExitClosesRealPosition() public {
        uint256 collateralAmt = 100e6;
        uint256 debtAmt = 5e6;
        _openPosition(collateralAmt, debtAmt);

        // Fund the DEX with USDC and have it return 50 USDC for the collateral.
        uint256 swapOut = 50e6;
        deal(market.loanToken, address(dex), swapOut);
        bytes memory swapCalldata = abi.encodeCall(
            MockDex.swapExact, (market.collateralToken, collateralAmt, market.loanToken, swapOut, address(exit))
        );

        MorphoExitExecutor.ExitParams memory p = MorphoExitExecutor.ExitParams({
            market: market,
            mode: MorphoExitExecutor.ExitMode.FULL_TO_LOAN,
            repayAssets: 0,
            withdrawAssets: 0,
            swapCollateralIn: collateralAmt,
            minLoanOut: 40e6,
            dex: address(dex),
            swapCalldata: swapCalldata,
            deadline: block.timestamp + 600
        });

        vm.prank(user);
        exit.exitPosition(p);

        (, uint128 borrowShares, uint128 collateral) = IMorphoForkExit(MORPHO_BLUE).position(MARKET_ID, user);
        assertEq(borrowShares, 0, "debt not cleared on real morpho");
        assertEq(collateral, 0, "collateral not withdrawn on real morpho");
        assertGt(IERC20(market.loanToken).balanceOf(user), 0, "user received surplus");
        assertEq(IERC20(market.loanToken).balanceOf(address(exit)), 0, "no loan dust");
        assertEq(IERC20(market.collateralToken).balanceOf(address(exit)), 0, "no collateral dust");
    }
}
