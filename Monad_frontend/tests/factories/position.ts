// Factory for Morpho PositionView objects used by exit-math and exit-service tests.
import type { PositionView } from "@domains/yield/types/exit.js";
import { TOKENS } from "../datasets/base.js";

/**
 * A healthy cbETH-USDC position by default:
 *  - 2 cbETH collateral worth 4 USDC (so oracle-implied price ~2 USDC/cbETH here,
 *    intentionally small numbers to keep the arithmetic obvious in assertions)
 *  - 1 USDC debt => LTV 25%
 */
export function makePositionView(o: Partial<PositionView> = {}): PositionView {
  return {
    market: "cbETH-USDC",
    collateralToken: TOKENS.cbETH,
    loanToken: TOKENS.USDC,
    collateral: 2_000_000_000_000_000_000n, // 2 cbETH (18 dp)
    debt: 1_000_000n, // 1 USDC (6 dp)
    collateralValue: 4_000_000n, // 4 USDC of value
    ltv: 0.25,
    lltv: 0.86,
    ...o,
  };
}
