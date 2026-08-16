// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockMorphoBlue.sol";
import "../mocks/MockOracle.sol";
import "../mocks/MockReentrantToken.sol";

/// @title MorphoStrategyAdapter — comprehensive scenario & security tests
/// @notice Focuses on the high-value paths of the oracle-based borrow:
///         decimals correctness (6/8/18 dp), live oracle reads, swap-loss
///         resilience, multi-loop sequencing, ceiling/floor boundaries,
///         repay↔borrow interplay, lifecycle (pause), access control,
///         the BorrowExecuted event, reentrancy, and a fuzz property that
///         the resulting LTV never exceeds the target.
///
/// @dev The MockMorphoBlue does NOT enforce a health check or accrue interest.
///      Tests that require real Morpho health/accrual/oracle-wrapper behaviour
///      live in the fork suite, not here.
contract MorphoStrategyAdapterScenariosTest is Test {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant ORACLE_PRICE_SCALE = 1e36;
    uint256 internal constant LLTV_915 = 915000000000000000; // 91.5%

    MorphoStrategyAdapter internal adapter;
    MockMorphoBlue internal morpho;

    address internal owner;
    address internal executorAddr = address(0xE);
    address internal user = address(0xA1);

    // Loan token shared across markets: USDC (6 dp).
    MockUSDC internal usdc;

    function setUp() public {
        owner = address(this);
        usdc = new MockUSDC();
        morpho = new MockMorphoBlue();

        MorphoStrategyAdapter impl = new MorphoStrategyAdapter(address(morpho));
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(MorphoStrategyAdapter.initialize, (executorAddr, owner))
        );
        adapter = MorphoStrategyAdapter(address(proxy));

        // Fund Morpho with a large USDC reserve so borrows can be served.
        usdc.mint(address(this), 10_000_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 10_000_000e6);
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Helpers
    // ──────────────────────────────────────────────────────────────────────

    /// @dev Oracle price for a collateral worth `usdPrice` dollars, where the
    ///      collateral has `collatDec` decimals and the loan token (USDC) has 6.
    ///      Morpho scale: price = usdPrice * 1e36 * 10^loanDec / 10^collatDec.
    function _priceFor(
        uint256 usdPrice,
        uint8 collatDec
    ) internal pure returns (uint256) {
        return (usdPrice * ORACLE_PRICE_SCALE * 1e6) / (10 ** collatDec);
    }

    function _market(
        address collateral,
        address oracle
    ) internal view returns (IMorphoBlue.MarketParams memory) {
        return
            IMorphoBlue.MarketParams({
                loanToken: address(usdc),
                collateralToken: collateral,
                oracle: oracle,
                irm: address(0),
                lltv: LLTV_915
            });
    }

    function _supply(
        IMorphoBlue.MarketParams memory m,
        uint256 amount
    ) internal {
        MockERC20(m.collateralToken).mint(address(adapter), amount);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            m.collateralToken,
            amount,
            user,
            abi.encode(m)
        );
    }

    function _borrow(
        IMorphoBlue.MarketParams memory m,
        uint256 targetLtvWad,
        uint256 maxBorrow,
        uint256 minBorrow
    ) internal returns (uint256 amountOut) {
        vm.prank(executorAddr);
        (, amountOut) = adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, targetLtvWad, maxBorrow, minBorrow)
        );
    }

    /// @dev Expected borrow = collateral * price / 1e36 * ltv / 1e18 - currentDebt.
    function _expectedBorrow(
        uint256 collateral,
        uint256 price,
        uint256 ltvWad,
        uint256 currentDebt
    ) internal pure returns (uint256) {
        uint256 collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
        uint256 targetDebt = (collateralValue * ltvWad) / WAD;
        return targetDebt - currentDebt;
    }

    function _debtOf(
        IMorphoBlue.MarketParams memory m
    ) internal view returns (uint256) {
        (, uint128 borrowShares, ) = morpho.positionFor(m, user);
        return uint256(borrowShares); // mock tracks shares 1:1 with assets
    }

    // ══════════════════════════════════════════════════════════════════════
    //  A. Decimals correctness: 18dp / 8dp / 6dp collateral, USDC loan
    // ══════════════════════════════════════════════════════════════════════

    function test_decimals_WETH18_borrowUSDC6() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18); // $3000 per WETH
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18); // 1 WETH = $3000
        uint256 expected = _expectedBorrow(1e18, price, 0.8e18, 0); // 2400 USDC
        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);

        assertEq(got, expected, "WETH borrow amount");
        assertEq(got, 2400e6, "WETH borrow == 2400 USDC");
    }

    function test_decimals_cbBTC8_borrowUSDC6() public {
        MockERC20 cbbtc = new MockERC20("Coinbase BTC", "cbBTC", 8);
        uint256 price = _priceFor(60000, 8); // $60,000 per cbBTC
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(cbbtc),
            address(oracle)
        );

        _supply(m, 1e8); // 1 cbBTC = $60,000
        uint256 expected = _expectedBorrow(1e8, price, 0.5e18, 0); // 30000 USDC
        uint256 got = _borrow(m, 0.5e18, type(uint256).max, 0);

        assertEq(got, expected, "cbBTC borrow amount");
        assertEq(got, 30000e6, "cbBTC borrow == 30000 USDC");
    }

    function test_decimals_USDC6_borrowUSDC6() public {
        // Collateral and loan both 6dp, $1 each.
        MockERC20 usdcCollat = new MockERC20("USD Coin C", "USDCc", 6);
        uint256 price = _priceFor(1, 6); // $1
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(usdcCollat),
            address(oracle)
        );

        _supply(m, 1000e6); // $1000
        uint256 got = _borrow(m, 0.75e18, type(uint256).max, 0);
        assertEq(got, 750e6, "stable/stable borrow == 750 USDC");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  B. Live oracle reads (price changes between supply and borrow)
    // ══════════════════════════════════════════════════════════════════════

    function test_oraclePriceDoubles_betweenSupplyAndBorrow() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18);
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18); // 1 WETH supplied at $3000

        // Price doubles to $6000 before the borrow step executes.
        uint256 newPrice = _priceFor(6000, 18);
        oracle.setPrice(newPrice);

        uint256 got = _borrow(m, 0.5e18, type(uint256).max, 0);
        // Borrow sizes against the NEW price: 1 WETH * $6000 * 50% = 3000 USDC.
        assertEq(got, 3000e6, "borrow uses live (doubled) price");
    }

    function test_oraclePriceHalves_betweenSupplyAndBorrow() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        oracle.setPrice(_priceFor(1500, 18)); // halves to $1500

        uint256 got = _borrow(m, 0.5e18, type(uint256).max, 0);
        assertEq(got, 750e6, "borrow uses live (halved) price"); // 1 * 1500 * 50%
    }

    // ══════════════════════════════════════════════════════════════════════
    //  C. Swap-loss resilience — sizing against REAL collateral keeps LTV at target
    // ══════════════════════════════════════════════════════════════════════

    function test_swapLoses_0_1pct_ltvStaysAtTarget() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18);
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        // Ideal collateral would be 1 WETH, but a 0.1% swap loss lands 0.999 WETH.
        uint256 landed = (1e18 * 9990) / 10000;
        _supply(m, landed);

        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);
        // Real LTV = debt / collateralValue should equal target exactly.
        uint256 collateralValue = (landed * price) / ORACLE_PRICE_SCALE;
        uint256 realLtv = (got * WAD) / collateralValue;
        assertApproxEqAbs(
            realLtv,
            0.8e18,
            1e6,
            "LTV stays at 80% despite 0.1% loss"
        );
    }

    function test_swapLoses_1pct_ltvStaysAtTarget() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18);
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        uint256 landed = (1e18 * 9900) / 10000; // 1% swap loss
        _supply(m, landed);

        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);
        uint256 collateralValue = (landed * price) / ORACLE_PRICE_SCALE;
        uint256 realLtv = (got * WAD) / collateralValue;
        assertApproxEqAbs(
            realLtv,
            0.8e18,
            1e6,
            "LTV stays at 80% despite 1% loss"
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  D. Multi-loop leverage sequencing — each borrow re-reads real state
    // ══════════════════════════════════════════════════════════════════════

    function test_multiLoop_threeLoops_noDrift() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18); // $3000
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        uint256 ltv = 0.5e18;

        // Loop 0: supply 1 WETH, borrow to 50%.
        _supply(m, 1e18);
        uint256 b0 = _borrow(m, ltv, type(uint256).max, 0);
        assertEq(b0, 1500e6, "loop0 borrow"); // 3000*0.5

        // Loop 1: the 1500 USDC swaps into 0.5 WETH; supply it, borrow to 50%.
        _supply(m, 0.5e18); // collateral now 1.5 WETH = $4500
        uint256 b1 = _borrow(m, ltv, type(uint256).max, 0);
        assertEq(b1, 750e6, "loop1 borrow gap"); // target 2250 - debt 1500

        // Loop 2: 750 USDC -> 0.25 WETH; supply; borrow to 50%.
        _supply(m, 0.25e18); // collateral 1.75 WETH = $5250
        uint256 b2 = _borrow(m, ltv, type(uint256).max, 0);
        assertEq(b2, 375e6, "loop2 borrow gap"); // target 2625 - debt 2250

        // Aggregate debt matches the geometric series; LTV is exactly 50%.
        uint256 totalDebt = _debtOf(m);
        assertEq(totalDebt, 2625e6, "total debt after 3 loops");
        uint256 collateralValue = (1.75e18 * price) / ORACLE_PRICE_SCALE;
        assertEq(
            (totalDebt * WAD) / collateralValue,
            ltv,
            "final LTV == target"
        );
    }

    function test_multiLoop_tailIterationHitsDustFloor() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        _borrow(m, 0.5e18, type(uint256).max, 0); // debt 1500

        // No new collateral supplied; asking again for 50% yields a zero gap →
        // NothingToBorrow (a stricter case than the dust floor).
        vm.prank(executorAddr);
        vm.expectRevert(MorphoStrategyAdapter.NothingToBorrow.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, uint256(0.5e18), type(uint256).max, uint256(0))
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  E. Ceiling / floor boundaries
    // ══════════════════════════════════════════════════════════════════════

    function test_borrowExactlyEqualsMaxBorrow_succeeds() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        // Borrow will be exactly 2400 USDC; set ceiling to exactly that.
        uint256 got = _borrow(m, 0.8e18, 2400e6, 0);
        assertEq(got, 2400e6, "borrow == ceiling succeeds");
    }

    function test_borrowOneWeiOverMaxBorrow_reverts() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(
                MorphoStrategyAdapter.BorrowExceedsCeiling.selector,
                2400e6,
                2400e6 - 1
            )
        );
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, uint256(0.8e18), uint256(2400e6 - 1), uint256(0))
        );
    }

    function test_borrowExactlyEqualsMinBorrow_succeeds() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        // Borrow 2400 USDC; minBorrow set exactly to 2400 → not below floor.
        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 2400e6);
        assertEq(got, 2400e6, "borrow == minBorrow succeeds");
    }

    function test_borrowOneWeiBelowMinBorrow_reverts() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(MorphoStrategyAdapter.BorrowBelowMinimum.selector, 2400e6, 2400e6 + 1)
        );
        adapter.execute(IStrategyAdapter.ActionType.BORROW, address(0), 0, user, abi.encode(m, 0.8e18, type(uint256).max, 2400e6 + 1));
    }

    // ══════════════════════════════════════════════════════════════════════
    //  F. repay ↔ borrow interplay
    // ══════════════════════════════════════════════════════════════════════

    function test_borrow_repayPart_borrowAgain_refillsGap() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18); // $3000 collateral
        _borrow(m, 0.8e18, type(uint256).max, 0); // debt 2400
        assertEq(_debtOf(m), 2400e6);

        // Repay 400 USDC (executor sends loan token to the adapter first).
        usdc.mint(address(adapter), 400e6);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc),
            400e6,
            user,
            abi.encode(m)
        );
        assertEq(_debtOf(m), 2000e6, "debt after partial repay");

        // Borrow back to 80%: gap is exactly the 400 we repaid.
        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);
        assertEq(got, 400e6, "re-borrow refills exactly the repaid gap");
        assertEq(_debtOf(m), 2400e6, "debt restored to target");
    }

    function test_borrow_fullRepay_borrowAgain_freshBorrow() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        _supply(m, 1e18);
        _borrow(m, 0.8e18, type(uint256).max, 0); // 2400

        usdc.mint(address(adapter), 2400e6);
        vm.prank(executorAddr);
        adapter.execute(
            IStrategyAdapter.ActionType.REPAY,
            address(usdc),
            2400e6,
            user,
            abi.encode(m)
        );
        assertEq(_debtOf(m), 0, "debt fully repaid");

        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);
        assertEq(got, 2400e6, "fresh borrow back to full target");
    }

    // ══════════════════════════════════════════════════════════════════════
    //  G. Lifecycle: pause / unpause
    // ══════════════════════════════════════════════════════════════════════

    function test_pause_blocksBorrow_unpauseRestores() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );
        _supply(m, 1e18);

        adapter.pause();
        vm.prank(executorAddr);
        vm.expectRevert(
            abi.encodeWithSelector(bytes4(keccak256("EnforcedPause()")))
        );
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, uint256(0.8e18), type(uint256).max, uint256(0))
        );

        adapter.unpause();
        uint256 got = _borrow(m, 0.8e18, type(uint256).max, 0);
        assertEq(got, 2400e6, "borrow works again after unpause");
    }

    function test_pause_nonOwner_reverts() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("OwnableUnauthorizedAccount(address)")),
                user
            )
        );
        adapter.pause();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  H. Access control
    // ══════════════════════════════════════════════════════════════════════

    function test_borrow_nonExecutor_reverts() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(_priceFor(3000, 18));
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );

        vm.prank(user);
        vm.expectRevert(MorphoStrategyAdapter.OnlyExecutor.selector);
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, uint256(0.8e18), type(uint256).max, uint256(0))
        );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  I. Event integrity
    // ══════════════════════════════════════════════════════════════════════

    function test_event_borrowExecuted_secondBorrowReportsPriorDebt() public {
        MockERC20 weth = new MockERC20("Wrapped Ether", "WETH", 18);
        uint256 price = _priceFor(3000, 18);
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(weth),
            address(oracle)
        );
        bytes32 id = keccak256(abi.encode(m));

        _supply(m, 1e18);
        _borrow(m, 0.5e18, type(uint256).max, 0); // debt now 1500

        _supply(m, 0.5e18); // collateral 1.5 WETH = $4500

        // Second borrow to 50%: target 2250, currentDebt 1500, borrowed 750.
        vm.expectEmit(true, true, false, true, address(adapter));
        emit MorphoStrategyAdapter.BorrowExecuted(
            user,
            id,
            1.5e18, // collateral
            4500e6, // collateralValue
            0.5e18, // targetLtvWad
            2250e6, // targetDebt
            1500e6, // currentDebt
            750e6 // borrowed
        );
        _borrow(m, 0.5e18, type(uint256).max, 0);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  J. Reentrancy
    // ══════════════════════════════════════════════════════════════════════

    function test_reentrancy_blockedOnBorrowForward() public {
        // Loan token re-enters the adapter when it is forwarded to the executor.
        MockReentrantToken loan = new MockReentrantToken("Re", "RE", 6);
        MockERC20 collat = new MockERC20("Collat", "C", 18);
        // Price: 1 collat (18dp) == $1 in a 6dp loan token => 1e24.
        MockOracle oracle = new MockOracle(_priceFor(1, 18));

        // Deploy a dedicated adapter whose executor is the attacker contract.
        ReentrantExecutor attacker = new ReentrantExecutor();
        MorphoStrategyAdapter aImpl = new MorphoStrategyAdapter(address(morpho));
        ERC1967Proxy aProxy = new ERC1967Proxy(
            address(aImpl),
            abi.encodeCall(MorphoStrategyAdapter.initialize, (address(attacker), owner))
        );
        MorphoStrategyAdapter a = MorphoStrategyAdapter(address(aProxy));
        attacker.configure(address(a));

        IMorphoBlue.MarketParams memory m = IMorphoBlue.MarketParams({
            loanToken: address(loan),
            collateralToken: address(collat),
            oracle: address(oracle),
            irm: address(0),
            lltv: LLTV_915
        });

        // Fund Morpho reserve with the reentrant loan token.
        loan.mint(address(this), 1_000_000e6);
        loan.transfer(address(morpho), 1_000_000e6);
        // Re-entry fires from the loan token's transfer; hook = attacker.
        loan.setHook(address(attacker));

        // Supply collateral via the attacker (acts as executor).
        collat.mint(address(a), 1000e18);
        attacker.doSupply(m, 1000e18, user);

        // Borrow: forwarding the loan token to the executor triggers the hook,
        // which re-enters execute(); nonReentrant must make the outer call revert.
        attacker.expectReentryBlocked();
        vm.expectRevert(
            abi.encodeWithSelector(
                bytes4(keccak256("ReentrancyGuardReentrantCall()"))
            )
        );
        attacker.doBorrow(m, 0.5e18, type(uint256).max, 0, user);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  K. Fuzz — resulting LTV never exceeds target; borrow never exceeds ceiling
    // ══════════════════════════════════════════════════════════════════════

    function testFuzz_borrowNeverExceedsTargetLtv(
        uint256 collateral,
        uint256 usdPrice,
        uint256 ltvPct
    ) public {
        collateral = bound(collateral, 1e15, 1_000e18); // 0.001 .. 1000 units (18dp)
        usdPrice = bound(usdPrice, 1, 100_000); // $1 .. $100k
        ltvPct = bound(ltvPct, 1, 90); // 1% .. 90% (< 91.5% LLTV)

        MockERC20 collat = new MockERC20("C", "C", 18);
        uint256 price = _priceFor(usdPrice, 18);
        MockOracle oracle = new MockOracle(price);
        IMorphoBlue.MarketParams memory m = _market(
            address(collat),
            address(oracle)
        );

        uint256 ltvWad = (ltvPct * WAD) / 100;
        uint256 collateralValue = (collateral * price) / ORACLE_PRICE_SCALE;
        // Skip dust cases the adapter legitimately rejects.
        uint256 targetDebt = (collateralValue * ltvWad) / WAD;
        vm.assume(targetDebt > 0);
        // Ensure Morpho reserve can serve it.
        vm.assume(targetDebt <= 10_000_000e6);

        _supply(m, collateral);
        uint256 got = _borrow(m, ltvWad, type(uint256).max, 0);

        // Resulting LTV (debt / collateralValue) must not exceed target.
        uint256 realLtv = (got * WAD) / collateralValue;
        assertLe(realLtv, ltvWad, "resulting LTV <= target");
    }
}

/// @notice Stand-in executor that re-enters the adapter through a token callback.
contract ReentrantExecutor is IReentryHook {
    MorphoStrategyAdapter internal adapter;
    bool internal expectBlocked;
    IMorphoBlue.MarketParams internal pendingMarket;

    function configure(address adapter_) external {
        adapter = MorphoStrategyAdapter(adapter_);
    }

    function expectReentryBlocked() external {
        expectBlocked = true;
    }

    function doSupply(
        IMorphoBlue.MarketParams calldata m,
        uint256 amount,
        address user
    ) external {
        adapter.execute(
            IStrategyAdapter.ActionType.SUPPLY_COLLATERAL,
            m.collateralToken,
            amount,
            user,
            abi.encode(m)
        );
    }

    function doBorrow(
        IMorphoBlue.MarketParams calldata m,
        uint256 ltvWad,
        uint256 maxBorrow,
        uint256 minBorrow,
        address user
    ) external {
        pendingMarket = m;
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            user,
            abi.encode(m, ltvWad, maxBorrow, minBorrow)
        );
    }

    /// @dev Called by the reentrant token during the borrow forward. Attempts a
    ///      nested borrow; the outer call's nonReentrant guard must make this revert,
    ///      which bubbles up and reverts the whole borrow.
    function reenter() external {
        if (!expectBlocked) return;
        adapter.execute(
            IStrategyAdapter.ActionType.BORROW,
            address(0),
            0,
            address(0xA1),
            abi.encode(
                pendingMarket,
                uint256(0.5e18),
                type(uint256).max,
                uint256(0)
            )
        );
    }
}
