//APY computer

import type {
  StrategyLeg,
  StrategyLegRates,
  AggregatedApy,
} from "@core/services/apy/types";

// NetApy = (collateralValue × collateralApy − debtValue × borrowApy) / equity
export function computeNetApy(params: {
  equity: number;
  collateralValue: number;
  debtValue: number;
  collateralApy: number;
  borrowApy: number;
  rewardsApy: number;
}): number {
  const {
    equity,
    collateralValue,
    debtValue,
    collateralApy,
    borrowApy,
    rewardsApy,
  } = params;
  const earn = collateralValue * collateralApy + debtValue * rewardsApy;
  const cost = debtValue * borrowApy;
  return (earn - cost) / equity;
}

/**
 * The single source of truth for leveraged strategy economics across ANY number of
 * markets. Sums each leg's earnings and costs at its OWN rate, credits idle borrowed
 * cash into equit, then divides by the user's real equity.
 *
 *   equity   = Σ collateralValue + idleCash − Σ debtValue
 *   netApy   = ( Σ collateralValue·c + Σ debt·rewards − Σ debt·borrow ) / equity
 *   leverage = Σ collateralValue / equity
 */
export function aggregateStrategyApy(
  legs: Array<StrategyLeg & StrategyLegRates>,
  idleCash: number,
): AggregatedApy {
  let totalCollateral = 0;
  let totalDebt = 0;
  let earn = 0;
  let cost = 0;
  let collateralWeighted = 0; // Σ collateralValue·c, for the value-weighted display blend
  let borrowWeighted = 0; // Σ debt·b, for the debt-weighted display blend
  let allOk = true;

  for (const leg of legs) {
    totalCollateral += leg.collateralValue;
    totalDebt += leg.debtValue;

    if (leg.collateralValue > 0) {
      if (leg.collateralStatus !== "ok" || leg.collateralApy === null)
        allOk = false;
    }
    if (leg.debtValue > 0) {
      if (leg.borrowStatus !== "ok" || leg.borrowApy === null) allOk = false;
    }

    const c = leg.collateralApy ?? 0;
    const b = leg.borrowApy ?? 0;
    earn += leg.collateralValue * c + leg.debtValue * leg.rewardsApy;
    cost += leg.debtValue * b;
    collateralWeighted += leg.collateralValue * c;
    borrowWeighted += leg.debtValue * b;
  }

  const equity = totalCollateral + idleCash - totalDebt;
  const leverage = equity > 0 ? totalCollateral / equity : 0;
  const ok = allOk && equity > 0;

  return {
    status: ok ? "ok" : "unavailable",
    equity,
    leverage,
    netApy: ok ? (earn - cost) / equity : null,
    collateralApy:
      totalCollateral > 0 ? collateralWeighted / totalCollateral : null,
    borrowApy: totalDebt > 0 ? borrowWeighted / totalDebt : null,
  };
}
