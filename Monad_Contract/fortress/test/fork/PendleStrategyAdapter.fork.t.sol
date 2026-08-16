// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/adapters/PendleStrategyAdapter.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../helpers/MonadFork.sol";

/// @notice Minimal struct matching Pendle's TokenInput for the simple swap function.
struct TokenInput {
    address tokenIn;
    uint256 netTokenIn;
    address tokenMintSy;
    address pendleSwap;
    SwapData swapData;
}

struct SwapData {
    SwapType swapType;
    address extRouter;
    bytes extCalldata;
    bool needScale;
}

enum SwapType {
    NONE,
    KYBERSWAP,
    ODOS,
    ETH_WETH,
    OKX,
    ONE_INCH,
    PARASWAP
}

/// @notice Interface for the simple PT swap function on Pendle RouterV4.
interface IPendleRouterSimple {
    function swapExactTokenForPtSimple(address receiver, address market, uint256 minPtOut, TokenInput calldata input)
        external
        payable
        returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);
}

/// @notice Fork test: PendleStrategyAdapter against the real Pendle Router on Base.
///         Verifies the adapter can relay calldata and buy PT-wcgUSD using USDC.
///         Run with: MONAD_RPC_URL=... forge test --match-path "test/fork/PendleStrategyAdapter*" -vvv
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract PendleStrategyAdapterForkTest is Test, MonadFork {
    address constant PENDLE_ROUTER = 0x888888888889758F76e7103c6CbF23ABbF58F946;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // yoUSD (24 Sep 2026) market on Base — not yet expired
    address constant PENDLE_MARKET = 0x250C15e59A7572195e248F668636723cCa20a2b8;
    address constant PT_TOKEN = 0x1fec97CA2817DA87F266fd1741BBA61CAf7CdE29;

    PendleStrategyAdapter internal adapter;
    address internal executorAddr;

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);

        // The test contract acts as the executor.
        executorAddr = address(this);

        PendleStrategyAdapter adapterImpl = new PendleStrategyAdapter(PENDLE_ROUTER);
        ERC1967Proxy adapterProxy = new ERC1967Proxy(
            address(adapterImpl), abi.encodeCall(PendleStrategyAdapter.initialize, (executorAddr, address(this)))
        );
        adapter = PendleStrategyAdapter(address(adapterProxy));

        // Whitelist Pendle RouterV4 selectors used in tests
        adapter.setApprovedRouterSelector(bytes4(0xfeb9d1d2), true);
    }

    /// @dev Build TokenInput struct for a direct USDC → SY (no external aggregator).
    function _buildTokenInput(uint256 amount) internal pure returns (TokenInput memory) {
        return TokenInput({
            tokenIn: USDC,
            netTokenIn: amount,
            tokenMintSy: USDC, // USDC is accepted by the wcgUSD SY contract
            pendleSwap: address(0),
            swapData: SwapData({swapType: SwapType.NONE, extRouter: address(0), extCalldata: "", needScale: false})
        });
    }

    /// @dev Encode full calldata for swapExactTokenForPtSimple that targets our adapter as receiver.
    function _buildRouterCalldata(uint256 amount, uint256 minPtOut) internal view returns (bytes memory) {
        TokenInput memory input = _buildTokenInput(amount);
        return abi.encodeCall(
            IPendleRouterSimple.swapExactTokenForPtSimple, (address(adapter), PENDLE_MARKET, minPtOut, input)
        );
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Buy PT with USDC via the adapter (exact mode)
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_buyPt_exactMode() public {
        uint256 amountIn = 100e6; // 100 USDC
        uint256 minPtOut = 1; // very low floor for fork test (real SDK would set this properly)

        // Fund the adapter with USDC (simulates executor transferring tokenIn).
        deal(USDC, address(adapter), amountIn);

        // Build the data payload for the adapter.
        bytes memory routerCalldata = _buildRouterCalldata(amountIn, minPtOut);
        bytes memory data = abi.encode(
            uint8(0), // sub-action 0: router relay
            PT_TOKEN, // tokenOut
            minPtOut, // minAmountOut
            false, // useFullBalance = false
            routerCalldata
        );

        // Execute via the adapter.
        (address tokenOut, uint256 received) =
            adapter.execute(IStrategyAdapter.ActionType.SWAP, USDC, amountIn, address(0), data);

        // Assertions
        assertEq(tokenOut, PT_TOKEN, "output token is PT");
        assertGt(received, 0, "received PT > 0");

        // PT should be at the executor (this contract) since adapter transfers output there.
        assertEq(IERC20(PT_TOKEN).balanceOf(executorAddr), received, "executor holds PT");

        // Adapter should have no residual USDC or PT.
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "no residual USDC");
        assertEq(IERC20(PT_TOKEN).balanceOf(address(adapter)), 0, "no residual PT");

        // Approval cleared.
        assertEq(IERC20(USDC).allowance(address(adapter), PENDLE_ROUTER), 0, "approval cleared");
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Buy PT with USDC via the adapter (full balance mode)
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_buyPt_fullBalanceMode() public {
        uint256 amountIn = 50e6; // 50 USDC

        // Fund the adapter.
        deal(USDC, address(adapter), amountIn);

        // Build calldata — the calldata encodes amountIn but in full-balance mode
        // the adapter uses its live balance (which happens to match here).
        bytes memory routerCalldata = _buildRouterCalldata(amountIn, 1);
        bytes memory data = abi.encode(
            uint8(0), // sub-action 0: router relay
            PT_TOKEN,
            uint256(1), // minAmountOut
            true, // useFullBalance = true
            routerCalldata
        );

        (address tokenOut, uint256 received) = adapter.execute(
            IStrategyAdapter.ActionType.SWAP,
            USDC,
            0, // amount param ignored in full-balance mode
            address(0),
            data
        );

        assertEq(tokenOut, PT_TOKEN);
        assertGt(received, 0, "received PT > 0 in full balance mode");
        assertEq(IERC20(PT_TOKEN).balanceOf(executorAddr), received);
    }

    // ──────────────────────────────────────────────────────────────────────
    //  Slippage protection: minPtOut too high causes revert
    // ──────────────────────────────────────────────────────────────────────

    function test_fork_buyPt_slippageReverts() public {
        uint256 amountIn = 10e6; // 10 USDC
        uint256 absurdMinPtOut = 1_000_000e6; // impossible to get this many PT

        deal(USDC, address(adapter), amountIn);

        bytes memory routerCalldata = _buildRouterCalldata(amountIn, absurdMinPtOut);
        bytes memory data = abi.encode(
            uint8(0), // sub-action 0: router relay
            PT_TOKEN,
            absurdMinPtOut,
            false,
            routerCalldata
        );

        // The Pendle Router itself will revert — the adapter bubbles the
        // Router's raw error verbatim via assembly.
        vm.expectRevert();
        adapter.execute(IStrategyAdapter.ActionType.SWAP, USDC, amountIn, address(0), data);
    }
}
