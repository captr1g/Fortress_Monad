import { getChainByKey } from "@core/registry/index.js";
import { MorphoMarketService, computeMarketId } from "@chains/evm/protocols/morpho/morpho.service.js";
import { computeNetApy } from "@chains/evm/execution/apy.js";
import type { ApyResolverPort } from "@core/services/apy/types.js";

export type LoopSuggestion = {
  label: string;
  insertText: string;
  currentApy: number;
  projectedApy: number;
  leverage: number;
};

// 50% target LTV, well clear of Morpho's LLTV thresholds (typically 80%+ for
// correlated collateral pairs) — a conservative default for a casually
// surfaced suggestion, not a user-tuned position.
const TARGET_LTV = 0.5;
const LEVERAGE = 1 / (1 - TARGET_LTV); // 2x

// Must clear the plan the user is already about to get by a real margin —
// "technically positive" isn't the bar. A loop that's barely better isn't
// worth the added liquidation risk, so it's withheld rather than suggested.
const MIN_IMPROVEMENT = 0.01; // +1 percentage point

// Projects what looping the user's own starting asset (instead of swapping
// it away) would net, and only returns a suggestion when that's a real,
// clearly-better outcome, never a marginal or negative one. All three rate
// sources (market resolution, staking APY, borrow APY) can come back empty —
// each case returns undefined rather than showing a suggestion built on a
// guess.
export async function suggestLoop(params: {
  chainKey: string;
  chainId: number;
  inputTokenAddress: string;
  currentNetApy: number | null;
  apyResolver?: ApyResolverPort;
}): Promise<LoopSuggestion | undefined> {
  const { chainKey, chainId, inputTokenAddress, currentNetApy, apyResolver } = params;
  if (!apyResolver || currentNetApy === null) return undefined;

  const chain = getChainByKey(chainKey);
  if (!chain) return undefined;

  const collateralToken = chain.tokens.find(
    (t) => t.address.toLowerCase() === inputTokenAddress.toLowerCase(),
  );
  if (!collateralToken) return undefined;

  const isLoopEligible = chain.markets.some(
    (m) => m.collateral.toLowerCase() === collateralToken.symbol.toLowerCase(),
  );
  if (!isLoopEligible) return undefined;

  const loanToken = chain.tokens.find((t) => t.symbol === chain.loanToken);
  if (!loanToken) return undefined;

  const morphoMarkets = new MorphoMarketService(chainId);
  const market = await morphoMarkets
    .fetchMarketByPair(collateralToken.address, loanToken.address, TARGET_LTV)
    .catch(() => null);
  if (!market) return undefined;

  const marketKey = computeMarketId(market);
  const [collateral, borrow] = await Promise.all([
    apyResolver.resolve({
      kind: "staking",
      chainId,
      token: collateralToken.address,
      name: `${collateralToken.symbol} staking`,
    }),
    apyResolver.resolve({
      kind: "morpho",
      chainId,
      marketKey,
      name: `${collateralToken.symbol}/${loanToken.symbol}`,
    }),
  ]);

  if (collateral.status !== "ok" || collateral.rates?.supplyApy == null) return undefined;
  if (borrow.status !== "ok" || borrow.rates?.borrowApy == null) return undefined;

  const projectedApy = computeNetApy({
    equity: 1,
    collateralValue: LEVERAGE,
    debtValue: LEVERAGE - 1,
    collateralApy: collateral.rates.supplyApy,
    borrowApy: borrow.rates.borrowApy,
    rewardsApy: borrow.rates.rewardsApy ?? 0,
  });

  if (projectedApy <= currentNetApy + MIN_IMPROVEMENT) return undefined;

  return {
    label: `Loop ${collateralToken.symbol} at ${LEVERAGE.toFixed(1)}x for ~${(projectedApy * 100).toFixed(1)}% instead of ${(currentNetApy * 100).toFixed(1)}%`,
    insertText: `Loop my ${collateralToken.symbol} at ${LEVERAGE.toFixed(1)}x leverage.`,
    currentApy: currentNetApy,
    projectedApy,
    leverage: LEVERAGE,
  };
}
