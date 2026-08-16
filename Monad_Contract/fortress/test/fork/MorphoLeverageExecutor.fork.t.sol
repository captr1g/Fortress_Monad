// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/MorphoLeverageExecutor.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IOracle.sol";
import "../mocks/MockDex.sol";

/// @notice Real Morpho Blue (Base mainnet) test for the flash-loan leverage entry. Validates
///         the two things the mock cannot: the real Morpho flashLoan callback wiring and the
///         real supply/borrow with on-chain health enforcement. The loan→collateral swap leg
///         uses a fork-deployed MockDex funded via `deal` (real swap calldata is built off-chain
///         by LiFi and is not deterministic in a fork). Collateral output is sized off the real
///         oracle so the resulting LTV is comfortably below LLTV.
interface IMorphoForkLev {
    function idToMarketParams(
        bytes32 id
    )
        external
        view
        returns (
            address loanToken,
            address collateralToken,
            address oracle,
            address irm,
            uint256 lltv
        );

    function position(
        bytes32 id,
        address user
    )
        external
        view
        returns (
            uint256 supplyShares,
            uint128 borrowShares,
            uint128 collateral
        );

    function setAuthorization(
        address authorized,
        bool newIsAuthorized
    ) external;
}

contract MorphoLeverageExecutorForkTest is Test {
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;

    address constant MORPHO_BLUE = 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb;
    bytes32 constant MARKET_ID =
        0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137;

    MorphoLeverageExecutor internal lev;
    MockDex internal dex;
    IMorphoBlue.MarketParams internal market;

    address internal user = address(0xA11CE);

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        (
            address loanToken,
            address collateralToken,
            address oracle,
            address irm,
            uint256 lltv
        ) = IMorphoForkLev(MORPHO_BLUE).idToMarketParams(MARKET_ID);
        market = IMorphoBlue.MarketParams({
            loanToken: loanToken,
            collateralToken: collateralToken,
            oracle: oracle,
            irm: irm,
            lltv: lltv
        });

        MorphoLeverageExecutor levImpl = new MorphoLeverageExecutor(MORPHO_BLUE);
        ERC1967Proxy levProxy = new ERC1967Proxy(
            address(levImpl),
            abi.encodeCall(MorphoLeverageExecutor.initialize, (address(this)))
        );
        lev = MorphoLeverageExecutor(address(levProxy));
        dex = new MockDex();
        lev.setApprovedDex(address(dex), true);
        lev.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        vm.prank(user);
        IMorphoForkLev(MORPHO_BLUE).setAuthorization(address(lev), true);
    }

    function test_fork_opensLeveragePositionOnRealMorpho() public {
        uint256 input = 5e6; // 5 loan-token units of equity
        uint256 flash = 5e6; // 2x nominal
        uint256 swapIn = input + flash;

        // Size collateral so its oracle value ≈ 10x the debt → LTV ~10%, safely healthy.
        uint256 price = IOracle(market.oracle).price();
        uint256 targetCollateralValue = flash * 10;
        uint256 collatOut = (targetCollateralValue * ORACLE_PRICE_SCALE) / price;

        deal(market.loanToken, user, input);
        deal(market.collateralToken, address(dex), collatOut);

        vm.startPrank(user);
        IERC20(market.loanToken).approve(address(lev), input);
        vm.stopPrank();

        bytes memory swapCalldata = abi.encodeCall(
            MockDex.swapExact,
            (
                market.loanToken,
                swapIn,
                market.collateralToken,
                collatOut,
                address(lev)
            )
        );

        MorphoLeverageExecutor.LeverageParams memory p = MorphoLeverageExecutor
            .LeverageParams({
                market: market,
                inputAssets: input,
                flashAssets: flash,
                minCollateralOut: (collatOut * 99) / 100,
                dex: address(dex),
                swapCalldata: swapCalldata,
                deadline: block.timestamp + 600
            });

        vm.prank(user);
        lev.openLeverage(p);

        (, uint128 borrowShares, uint128 collateral) = IMorphoForkLev(
            MORPHO_BLUE
        ).position(MARKET_ID, user);

        assertEq(collateral, collatOut, "collateral not supplied on real morpho");
        assertGt(borrowShares, 0, "no debt opened on real morpho");
        assertEq(
            IERC20(market.loanToken).balanceOf(address(lev)),
            0,
            "no loan dust"
        );
        assertEq(
            IERC20(market.collateralToken).balanceOf(address(lev)),
            0,
            "no collateral dust"
        );
    }
}
