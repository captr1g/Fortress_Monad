// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../src/interfaces/IStrategyAdapter.sol";
import "../helpers/MonadFork.sol";

/// @notice E2E fork test: deployed executor → registered Pendle adapter → real Pendle Router on Base.
///         Uses swapExactTokenForPtSimple with fresh calldata (no stale SDK hex).
///         Run: MONAD_RPC_URL=... forge test --match-path "test/fork/PendleE2E*" -vvvv
interface IFortStrategyExecutor {
    struct Step {
        uint8 adapterId;
        IStrategyAdapter.ActionType action;
        address tokenIn;
        uint16 bps;
        uint256 amountFixed;
        bytes data;
    }

    function executeStrategy(address inputToken, uint256 inputAmount, Step[] calldata steps, uint256 deadline)
        external;

    function getAdapter(uint8 adapterId) external view returns (address);
}

/// @notice Minimal structs matching Pendle's TokenInput for the simple swap function.
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

interface IPendleRouterSimple {
    function swapExactTokenForPtSimple(address receiver, address market, uint256 minPtOut, TokenInput calldata input)
        external
        payable
        returns (uint256 netPtOut, uint256 netSyFee, uint256 netSyInterm);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 STATUS: forks Monad mainnet at the pinned block (test/helpers/MonadFork.sol),
// but the market/token addresses below are still BASE values and do not exist on
// Monad. This test WILL FAIL until Phase 4 rebuilds its fixtures from the live
// Monad markets enumerated in RESEARCH.md §5 and §6.
// Excluded from CI (`--no-match-path "test/fork/*"`).
// ─────────────────────────────────────────────────────────────────────────────
contract PendleE2EForkTest is Test, MonadFork {
    address constant EXECUTOR = 0x09Acd25f4Cd57155C47edc4b82855b50Ba67ad0D;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // yoUSD (24 Sep 2026) market on Base
    address constant PENDLE_MARKET = 0x250C15e59A7572195e248F668636723cCa20a2b8;
    address constant PT_TOKEN = 0x1fec97CA2817DA87F266fd1741BBA61CAf7CdE29;

    uint8 constant PENDLE_ID = 2;

    address internal user = address(0xA11CE);
    address internal adapter;

    function setUp() public {
        vm.createSelectFork(vm.envString("MONAD_RPC_URL"), FORK_BLOCK);
        adapter = IFortStrategyExecutor(EXECUTOR).getAdapter(PENDLE_ID);
    }

    function test_fork_buyPtThroughExecutor() public {
        uint256 amount = 500_000; // 0.5 USDC

        deal(USDC, user, amount);
        vm.prank(user);
        IERC20(USDC).approve(EXECUTOR, amount);

        // Build fresh calldata: swapExactTokenForPtSimple, receiver = adapter
        TokenInput memory input = TokenInput({
            tokenIn: USDC,
            netTokenIn: amount,
            tokenMintSy: USDC,
            pendleSwap: address(0),
            swapData: SwapData({swapType: SwapType.NONE, extRouter: address(0), extCalldata: "", needScale: false})
        });

        bytes memory routerCalldata =
            abi.encodeCall(IPendleRouterSimple.swapExactTokenForPtSimple, (adapter, PENDLE_MARKET, 1, input));

        bytes memory adapterData = abi.encode(
            uint8(0), // sub-action 0: router relay
            PT_TOKEN,
            uint256(1), // minAmountOut
            false, // useFullBalance
            routerCalldata
        );

        IFortStrategyExecutor.Step[] memory steps = new IFortStrategyExecutor.Step[](1);
        steps[0] = IFortStrategyExecutor.Step({
            adapterId: PENDLE_ID,
            action: IStrategyAdapter.ActionType.SWAP,
            tokenIn: USDC,
            bps: 10000,
            amountFixed: 0,
            data: adapterData
        });

        vm.prank(user);
        IFortStrategyExecutor(EXECUTOR).executeStrategy(USDC, amount, steps, block.timestamp + 600);

        // Executor holds PT after strategy (output stays at executor for multi-step flows).
        uint256 ptOnExecutor = IERC20(PT_TOKEN).balanceOf(EXECUTOR);
        assertGt(ptOnExecutor, 0, "executor received PT");
    }
}
