import { ltvToWad } from "../../helper/utils";
import { WAD } from "@domains/yield/types/market";
import type { ExitMode, PositionView } from "@domains/yield/types/exit.js";
import type { ExitAmounts } from "@domains/yield/types/market.js";

// Given collateral and its value, what collateral amount is needed to support a given loan value?
export function collateralForLoanValue(
  position: Pick<PositionView, "collateral" | "collateralValue">,
  loanValue: bigint,
): bigint {
  if (position.collateralValue === 0n) return 0n;
  return (loanValue * position.collateral) / position.collateralValue;
}

// Per-mode exit amounts. FULL modes read debt/collateral from the live position;
// the contract re-reads both on-chain so these are exact. A 1% headroom covers
// swap slippage when sizing the collateral to sell.
export function computeExitAmounts(
  mode: ExitMode,
  position: PositionView,
  targetLtv?: number,
): ExitAmounts {
  if (mode === "full_to_loan") {
    return {
      repayAssets: 0n,
      withdrawAssets: 0n,
      collateralToSell: position.collateral,
      collateralReturned: 0n,
    };
  }

  if (mode === "full_to_collateral") {
    const debtWithBuffer = (position.debt * 10100n) / 10000n; // 1% buffer as margin
    const collateralToSell = collateralForLoanValue(position, debtWithBuffer);
    if (collateralToSell > position.collateral)
      throw new Error("Position underwater: collateral cannot cover debt.");
    return {
      repayAssets: 0n,
      withdrawAssets: 0n,
      collateralToSell,
      collateralReturned: position.collateral - collateralToSell,
    };
  }

  if (targetLtv === undefined)
    throw new Error("Deleverage requires a targetLtv.");
  const targetLtvWad = ltvToWad(targetLtv);
  const targetDebt = (position.collateralValue * targetLtvWad) / WAD;
  if (targetDebt >= position.debt)
    throw new Error(
      "Target LTV is not below the current LTV; nothing to deleverage.",
    );

  // A flash-loan deleverage sells collateral to fund the repay, shrinking BOTH debt
  // and collateral. To land at targetLtv after removing that collateral:
  //   debt - r = targetLtv * (collateralValue - r)  =>  r = (debt - targetDebt) / (1 - targetLtv)
  const repayAssets =
    ((position.debt - targetDebt) * WAD) / (WAD - targetLtvWad);
  const repayWithBuffer = (repayAssets * 10100n) / 10000n;
  const withdrawAssets = collateralForLoanValue(position, repayWithBuffer);
  if (withdrawAssets > position.collateral)
    throw new Error("Insufficient collateral to deleverage to target LTV.");
  return {
    repayAssets,
    withdrawAssets,
    collateralToSell: withdrawAssets,
    collateralReturned: 0n,
  };
}
