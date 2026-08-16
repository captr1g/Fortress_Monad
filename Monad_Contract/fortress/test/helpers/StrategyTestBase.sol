// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../src/FortStrategyExecutor.sol";
import "../../src/adapters/MorphoStrategyAdapter.sol";
import "../../src/adapters/SwapStrategyAdapter.sol";
import "../../src/interfaces/IMorphoBlue.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../mocks/MockUSDC.sol";
import "../mocks/MockERC20.sol";
import "../mocks/MockMorphoBlue.sol";
import "../mocks/MockDex.sol";
import "../mocks/MockOracle.sol";

/// @notice Shared setup for FortStrategyExecutor strategy-system tests.
abstract contract StrategyTestBase is Test {
    // Adapter ids
    uint8 internal constant SWAP_ID = 0;
    uint8 internal constant MORPHO_ID = 1;

    uint256 internal constant LLTV = 915000000000000000; // 91.5%

    FortStrategyExecutor internal executor;
    MorphoStrategyAdapter internal morphoAdapter;
    SwapStrategyAdapter internal swapAdapter;

    MockMorphoBlue internal morpho;
    MockDex internal dex;
    MockOracle internal oracle;
    MockUSDC internal usdc; // 6 decimals
    MockERC20 internal yoUSD; // 18 decimals

    // Oracle price: 1 yoUSD (18 dec) == 1 USDC (6 dec) of value.
    // Morpho price scale is 1e36, adjusted for decimals:
    //   price = 1e36 * 10^loanDec / 10^collatDec = 1e36 * 1e6 / 1e18 = 1e24
    uint256 internal constant ORACLE_PRICE_1TO1 = 1e24;

    address internal owner;
    address internal user = address(0xA1);

    function setUp() public virtual {
        owner = address(this);

        // Tokens
        usdc = new MockUSDC();
        yoUSD = new MockERC20("Yield USD", "yoUSD", 18);

        // Protocol mocks
        morpho = new MockMorphoBlue();
        dex = new MockDex();
        oracle = new MockOracle(ORACLE_PRICE_1TO1);

        // Executor behind UUPS proxy
        FortStrategyExecutor impl = new FortStrategyExecutor();
        bytes memory initData = abi.encodeCall(FortStrategyExecutor.initialize, ());
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        executor = FortStrategyExecutor(address(proxy));

        // Adapters (behind UUPS proxies)
        MorphoStrategyAdapter morphoImpl = new MorphoStrategyAdapter(address(morpho));
        ERC1967Proxy morphoProxy = new ERC1967Proxy(
            address(morphoImpl), abi.encodeCall(MorphoStrategyAdapter.initialize, (address(executor), owner))
        );
        morphoAdapter = MorphoStrategyAdapter(address(morphoProxy));

        SwapStrategyAdapter swapImpl = new SwapStrategyAdapter();
        ERC1967Proxy swapProxy = new ERC1967Proxy(
            address(swapImpl), abi.encodeCall(SwapStrategyAdapter.initialize, (address(executor), owner))
        );
        swapAdapter = SwapStrategyAdapter(address(swapProxy));

        // Register adapters
        executor.registerAdapter(SWAP_ID, address(swapAdapter));
        executor.registerAdapter(MORPHO_ID, address(morphoAdapter));

        // Allowlist the DEX on the swap adapter
        swapAdapter.setApprovedDex(address(dex), true);
        swapAdapter.setApprovedSwapSelector(MockDex.swapExact.selector, true);

        // Fund the DEX with a yoUSD reserve so it can serve swap outputs
        yoUSD.mint(address(dex), 1_000_000_000e18);

        // Fund Morpho with a USDC reserve so it can serve borrows
        usdc.mint(address(this), 1_000_000_000e6);
        usdc.approve(address(morpho), type(uint256).max);
        morpho.fundReserve(address(usdc), 1_000_000_000e6);
    }

    /// @notice MarketParams for the USDC/yoUSD market (loanToken=USDC, collateral=yoUSD).
    function _market() internal view returns (IMorphoBlue.MarketParams memory) {
        return IMorphoBlue.MarketParams({
            loanToken: address(usdc),
            collateralToken: address(yoUSD),
            oracle: address(oracle),
            irm: address(0),
            lltv: LLTV
        });
    }

    /// @notice Mint USDC to `user` and approve the executor to pull it.
    function _fundAndApprove(address account, uint256 amount) internal {
        usdc.mint(account, amount);
        vm.prank(account);
        usdc.approve(address(executor), amount);
    }

    /// @notice Build swap calldata + step data for a USDC->yoUSD swap on the MockDex.
    function _swapData(uint256 amountIn, uint256 amountOut, uint256 minAmountOut) internal view returns (bytes memory) {
        bytes memory swapCalldata = abi.encodeCall(
            MockDex.swapExact, (address(usdc), amountIn, address(yoUSD), amountOut, address(swapAdapter))
        );
        return abi.encode(
            address(dex),
            address(yoUSD),
            minAmountOut,
            false, // useFullBalance = false (exact mode)
            swapCalldata
        );
    }
}
