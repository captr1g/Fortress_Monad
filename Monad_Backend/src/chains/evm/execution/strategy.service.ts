import { Address, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import type { EvmTransaction, BuildResult, EvmChainConfig } from "../types.js";
import type {
  MorphoMarketParams,
  ExistingMarketPosition,
} from "@domains/yield/types/market.js";
import { StrategyBuilder } from "./strategy-builder.js";
import { fetchOraclePrice } from "./pricing.js";
import { validateStrategy } from "./strategy-validator.js";
import { tokenAddress } from "@core/registry/index.js";
import { aggregateStrategyApy } from "@chains/evm/execution/apy.js";

import {
  fetchLiFiUnwindQuote,
} from "../protocols/lifi/swap-resolver.js";
import { erc20Abi, morphoBlueAbi } from "../config/base_abi.js";
import { readFeeBps, netAfterFee } from "../helper/fee.js";
import type { Intent } from "@domains/yield/types/intent.js";
import type {
  StrategyIntent,
  StrategyBuildContext,
  StrategyStep,
} from "@domains/yield/types/strategy.js";
import {
  MorphoMarketService,
  fetchExistingPosition,
  computeMarketId,
} from "../protocols/morpho/morpho.service.js";
import {
  PendleMarketService,
  type PendleMarketInfo,
} from "../protocols/pendle/pendle.service.js";
import { FortressLogger } from "@shared/logger.js";
import { PlannerRefusal } from "@shared/errors.js";
import {
  type ApyResolverPort,
  type StrategyApy,
  type StepApy,
  type ApyTerm,
  type StrategyLeg,
  type StrategyLegRates,
} from "@core/services/apy/types.js";

import { ORACLE_PRICE_SCALE } from "./pricing.js";

export class StrategyService {
  private readonly strategyBuilder: StrategyBuilder;
  private readonly config: EvmChainConfig;
  private readonly morphoService: MorphoMarketService;
  private readonly pendleService: PendleMarketService;
  private readonly apyResolver?: ApyResolverPort;

  constructor(config: EvmChainConfig, apyResolver?: ApyResolverPort) {
    this.strategyBuilder = new StrategyBuilder();
    this.config = config;
    this.morphoService = new MorphoMarketService(config.chainId);
    this.pendleService = new PendleMarketService(config.chainId);
    this.apyResolver = apyResolver;
  }

  // Resolves every Pendle market referenced via protocolData.pendleMarket, then
  // rewrites the affected steps so the rest of the pipeline is Pendle-agnostic:
  //  - swapToPt.tokenOut       := PT address
  //  - supplyCollateral.tokenIn := PT address
  //  - Morpho steps' marketId   := the pendle label (unified lookup key)
  // Returns the PT-collateral Morpho markets keyed by that label.
  private async resolvePendleMarkets(
    intent: Extract<Intent, { action: "strategy" }>,
    targetLtv?: number,
  ): Promise<Map<string, MorphoMarketParams>> {
    const labels = new Set<string>();
    for (const step of intent.steps) {
      if (step.protocolData?.pendleMarket)
        labels.add(step.protocolData.pendleMarket);
    }
    if (labels.size === 0) return new Map();

    // Each label's market resolution is independent — resolve them concurrently
    // instead of paying N sequential round-trips for an N-market strategy.
    const infoByLabel = new Map<string, PendleMarketInfo>();
    const resolvedInfos = await Promise.all(
      [...labels].map(async (label) => {
        const info = await this.pendleService.resolveMarket(label);
        if (!info)
          throw new Error(
            `Pendle market "${label}" was not found on chain ${this.config.chainId}.`,
          );
        if (info.expired)
          throw new Error(
            `Pendle market "${label}" expired on ${info.expiry}; choose a live market.`,
          );
        return [label, info] as const;
      }),
    );
    for (const [label, info] of resolvedInfos) infoByLabel.set(label, info);

    // Loan token for each PT market: what a borrow against it receives, else the input token.
    const loanByLabel = new Map<string, Address>();
    for (const step of intent.steps) {
      const label = step.protocolData?.pendleMarket;
      if (label && step.action === "borrow") {
        loanByLabel.set(label, step.tokenIn as Address);
      }
    }

    const MORPHO_ACTIONS = new Set([
      "supplyCollateral",
      "borrow",
      "repay",
      "withdrawCollateral",
    ]);

    const pendleMorphoMarkets = new Map<string, MorphoMarketParams>();
    const morphoLookups = [...infoByLabel].filter(([label]) =>
      intent.steps.some(
        (s) =>
          s.protocolData?.pendleMarket === label &&
          MORPHO_ACTIONS.has(s.action),
      ),
    );
    const resolvedMorphoMarkets = await Promise.all(
      morphoLookups.map(async ([label, info]) => {
        const loanToken =
          loanByLabel.get(label) ?? (intent.inputToken as Address);
        const market = await this.morphoService.fetchMarketByPair(
          info.ptAddress,
          loanToken,
          targetLtv,
        );
        if (!market)
          throw new Error(
            `No Morpho market for PT ${info.ptAddress} / loan ${loanToken} on chain ${this.config.chainId}.`,
          );
        return [label, market] as const;
      }),
    );
    for (const [label, market] of resolvedMorphoMarkets) pendleMorphoMarkets.set(label, market);

    for (const step of intent.steps) {
      const label = step.protocolData?.pendleMarket;
      if (!label) continue;
      const info = infoByLabel.get(label)!;

      if (step.action === "swapToPt") step.tokenOut = info.ptAddress;
      if (step.action === "swapToYt") step.tokenOut = info.ytAddress;
      if (step.action === "addLiquidityPendle")
        step.tokenOut = info.marketAddress;
      if (step.action === "supplyCollateral") step.tokenIn = info.ptAddress;
      if (MORPHO_ACTIONS.has(step.action)) {
        if (!step.protocolData) (step as StrategyStep).protocolData = {};
        step.protocolData!.marketId = label;
      }
    }

    // Resolve LP wrappers for wrapLp steps. The wrapper address comes from the
    // on-chain lpWrapperFactory.wrappers(marketAddress) call.
    const LP_WRAPPER_FACTORY =
      "0xCa274A44a52241c1a8EFb9f84Bf492D8363929FC" as const;
    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i];
      if (step.action !== "wrapLp") continue;

      // Infer pendleMarket from the preceding addLiquidityPendle step if not set.
      let label = step.protocolData?.pendleMarket;
      if (!label) {
        for (let j = i - 1; j >= 0; j--) {
          if (
            intent.steps[j].action === "addLiquidityPendle" &&
            intent.steps[j].protocolData?.pendleMarket
          ) {
            label = intent.steps[j].protocolData!.pendleMarket;
            if (!step.protocolData) (step as StrategyStep).protocolData = {};
            step.protocolData!.pendleMarket = label;
            break;
          }
        }
      }

      const info = label ? infoByLabel.get(label) : null;
      if (!info) continue; // No Pendle market context — validator will catch it.

      try {
        const client = createPublicClient({
          chain: base,
          transport: http(this.config.rpcUrl),
        });
        const wrapperAddr = await client.readContract({
          address: LP_WRAPPER_FACTORY,
          abi: [
            {
              name: "wrappers",
              type: "function",
              stateMutability: "view",
              inputs: [{ name: "LP", type: "address" }],
              outputs: [{ type: "address" }],
            },
          ] as const,
          functionName: "wrappers",
          args: [info.marketAddress],
        });
        if (wrapperAddr === "0x0000000000000000000000000000000000000000") {
          throw new Error(
            `No LP wrapper deployed for Pendle market "${label}".`,
          );
        }
        step.tokenOut = wrapperAddr as Address;
        if (!step.protocolData) (step as StrategyStep).protocolData = {};
        step.protocolData!.dex = wrapperAddr as Address;
        step.tokenIn = info.marketAddress;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to resolve LP wrapper for "${label}": ${msg}`);
      }
    }

    return pendleMorphoMarkets;
  }

  // Resolve a market reference to on-chain params. Accepts a bytes32 uniqueKey or
  // a "COLLATERAL-LOAN" symbol label (e.g. cbETH-USDC). Returns null if unresolved.
  private async resolveMarketLabel(
    marketRef: string,
    targetLtv?: number,
  ): Promise<MorphoMarketParams | null> {
    if (/^0x[a-fA-F0-9]{64}$/.test(marketRef)) {
      return this.morphoService.fetchMarketByUniqueKey(marketRef);
    }
    const parts = marketRef.split(/[-/]/).map((s) => s.trim());
    if (parts.length === 1) {
      const token = tokenAddress(this.config.chainId, parts[0]);
      if (!token) return null;
      // Single token reference (e.g. "USDC"): match market with loan token
      return this.morphoService.fetchMarketByPair(token, token, targetLtv);
    }
    if (parts.length !== 2) return null;
    const collateralToken = tokenAddress(this.config.chainId, parts[0]);
    const loanToken = tokenAddress(this.config.chainId, parts[1]);
    if (!collateralToken || !loanToken) return null;
    return this.morphoService.fetchMarketByPair(
      collateralToken,
      loanToken,
      targetLtv,
    );
  }

  // Resolve a strategy intent into a flat list of transactions, including any setup transactions (e.g., Morpho adapter authorization) and expanded leverage loops if applicable.
  async resolveStrategy(
    intent: Extract<Intent, { action: "strategy" }>,
    walletAddress: Address,
    log?: FortressLogger,
  ): Promise<BuildResult> {
    // Resolve the amount if user just start with bro swap 100%
    const inputAmount = await this.resolveInputAmount(
      intent.inputToken as Address,
      intent.inputAmount,
      walletAddress,
    );

    // The executor skims its input fee before running step 1, so the balance the
    // steps actually operate on is the NET input. Entry-swap sizing and the balance
    // projection must use net so baked LiFi amounts never exceed the on-chain
    // balance; the gross inputAmount is still pulled from the user (arg + approval).
    const feeBps = await readFeeBps(
      this.config.rpcUrl,
      this.config.strategyExecutor,
    );
    const netInput = netAfterFee(inputAmount, feeBps);
    if (netInput === 0n) {
      throw new Error("Strategy input amount is fully consumed by the fee.");
    }

    // Guard: the executor will transferFrom(user, inputAmount). If the user doesn't
    // actually hold that much, the on-chain tx reverts with a confusing "transfer
    // amount exceeds balance" deep inside the ERC20. Catch it here with a clear
    // message so the user knows before signing. Common cause: LLM hallucinated
    // the decimal conversion (e.g. 18 decimals instead of 6 for USDC).
    const userBalance = await this.resolveInputAmount(
      intent.inputToken as Address,
      "0", // forces a live balance read
      walletAddress,
    ).catch(() => 0n);
    if (userBalance > 0n && inputAmount > userBalance) {
      const humanInput = (Number(inputAmount) / 1e6).toFixed(6);
      const humanBal = (Number(userBalance) / 1e6).toFixed(6);
      throw new PlannerRefusal(
        `The plan requires ${humanInput} of the input token but the wallet only holds ${humanBal}. ` +
        `This usually means the amount was converted to the wrong decimals. ` +
        `USDC uses 6 decimals (1 USDC = 1000000), not 18.`,
      );
    }

    // Safety net: if the LLM emitted loops > 1 but only wrote the loop body
    // once, expand it server-side so the steps array is fully flat.
    this.expandLoopsIfNeeded(intent);

    // Safety net: on a complex repeated-loop prompt, the planner model
    // sometimes sets marketId on the entry steps but drops it on a later
    // borrow/supplyCollateral step (observed live — the #1 cause of "Step N
    // is missing a market" rejections on multi-loop strategies). The
    // overwhelming common case is a single-market loop, so infer a missing
    // marketId from the nearest earlier Morpho step that set one, rather
    // than failing a plan the user's prompt actually specified correctly.
    this.fillMissingMarketIds(intent);

    // Resolve Pendle markets first: this rewrites swapToPt/supply steps and returns
    // the PT-collateral Morpho markets keyed by their pendle label.
    const morphoMarkets = await this.resolvePendleMarkets(
      intent,
      intent.targetLtv,
    );

    // Collect the remaining (non-Pendle) market labels referenced by the steps.
    const marketIds = new Set<string>();
    for (const step of intent.steps) {
      if (step.protocolData?.marketId)
        marketIds.add(step.protocolData.marketId);
    }

    const unresolvedMarketIds = [...marketIds].filter((id) => !morphoMarkets.has(id));
    const resolvedMarkets = await Promise.all(
      unresolvedMarketIds.map(async (marketId) => {
        const params = await this.resolveMarketLabel(marketId, intent.targetLtv);
        if (!params)
          throw new Error(
            `Morpho market "${marketId}" was not found on chain ${this.config.chainId}. Use a valid COLLATERAL-LOAN pair or market id.`,
          );
        return [marketId, params] as const;
      }),
    );
    for (const [marketId, params] of resolvedMarkets) morphoMarkets.set(marketId, params);

    // Default each borrow's targetLtv from the top-level value when the planner
    // omitted it, so sizing is always well-defined.
    for (const step of intent.steps) {
      if (
        step.action === "borrow" &&
        step.protocolData?.targetLtv === undefined &&
        intent.targetLtv !== undefined
      ) {
        if (!step.protocolData) (step as StrategyStep).protocolData = {};
        step.protocolData!.targetLtv = intent.targetLtv;
      }
    }

    // A swap whose input was produced by an earlier step (a prior swap's output
    // or a borrow) can only be sized at runtime, so it must spend the actual
    // landed balance rather than a build-time estimate. Only the raw input token
    // has a known exact starting balance.
    const producedTokens = new Set<string>();
    for (const step of intent.steps) {
      if (
        step.action === "swap" ||
        step.action === "swapToPt" ||
        step.action === "swapToYt" ||
        step.action === "addLiquidityPendle"
      ) {
        if (producedTokens.has(step.tokenIn.toLowerCase())) {
          if (!step.protocolData) (step as StrategyStep).protocolData = {};
          step.protocolData!.useFullBalance = true;
        }
        if (step.tokenOut) producedTokens.add(step.tokenOut.toLowerCase());
      } else if (step.action === "borrow") {
        producedTokens.add(step.tokenIn.toLowerCase());
      }
    }

    // Entry swaps from the input token use bps as "% of the original input". On-chain
    // bps means "% of current balance"
    // Pin each entry swap to an exact amount of the original
    // input. Stops once the input token is replenished by a borrow (loop reswaps must
    // size off the live balance, not a fixed amount).
    const inputKey = intent.inputToken.toLowerCase();
    let inputReplenished = false;
    for (const step of intent.steps) {
      if (step.action === "borrow" && step.tokenIn.toLowerCase() === inputKey) {
        inputReplenished = true;
        continue;
      }
      if (
        (step.action === "swap" ||
          step.action === "swapToPt" ||
          step.action === "swapToYt" ||
          step.action === "addLiquidityPendle") &&
        !inputReplenished &&
        step.tokenIn.toLowerCase() === inputKey &&
        !step.amountFixed
      ) {
        step.amountFixed = (
          (netInput * BigInt(step.bps)) /
          10000n
        ).toString();
      }
    }

    const resolvedSteps = intent.steps;
    validateStrategy(resolvedSteps, morphoMarkets, intent.inputToken, intent.targetLtv);

    // Read the live oracle price for every market that holds COLLATERAL or carries
    // a borrow. Multi-collateral strategies (e.g. cbETH + cbBTC) need a price for
    // EACH collateral leg to value it, not just the borrow market. A borrow with no
    // readable oracle is a hard error (we never guess a price); a zero price on a
    // collateral-only leg is likewise refused so we never value it wrong.
    const oraclePrices = new Map<string, bigint>();
    const borrowMarketIds = new Set<string>();
    const priceMarketIds = new Set<string>();
    for (const step of resolvedSteps) {
      if (step.action === "borrow" && step.protocolData?.marketId) {
        borrowMarketIds.add(step.protocolData.marketId);
        priceMarketIds.add(step.protocolData.marketId);
      }
      if (step.action === "supplyCollateral" && step.protocolData?.marketId) {
        priceMarketIds.add(step.protocolData.marketId);
      }
    }
    const priceResults = await Promise.all(
      [...priceMarketIds].map(async (id) => {
        const market = morphoMarkets.get(id);
        if (!market) return null;
        const price = await fetchOraclePrice(this.config.rpcUrl, market.oracle);
        if (price === 0n) {
          throw new Error(
            `Market ${id} oracle returned a zero price; refusing to size or value against it.`,
          );
        }
        return [id, price] as const;
      }),
    );
    for (const entry of priceResults) if (entry) oraclePrices.set(entry[0], entry[1]);

    const existingPositions = new Map<string, ExistingMarketPosition>();
    const positionResults = await Promise.all(
      [...borrowMarketIds].map(async (id) => {
        const market = morphoMarkets.get(id);
        if (!market) return null;
        const position = await fetchExistingPosition(
          this.config.rpcUrl,
          this.config.morphoBlue,
          market,
          walletAddress,
        );
        return [id, position] as const;
      }),
    );
    for (const entry of positionResults) if (entry) existingPositions.set(entry[0], entry[1]);

    // Swap calldata via the shared LiFi resolver
    const fetchSwapCalldata: StrategyBuildContext["fetchSwapCalldata"] = async (
      params,
    ) => {
      return fetchLiFiUnwindQuote({
        fromToken: params.fromToken,
        toToken: params.toToken,
        fromAmount: params.fromAmount,
        fromAddress: this.config.swapAdapter,
        chainId: this.config.chainId,
        slippage: params.slippage,
        lifiApiKey: this.config.lifiApiKey,
      });
    };

    // Pendle swap calldata via the Convert API. The receiver is the registered
    // adapter so its on-chain balance-delta check sees the PT.
    const fetchPendleCalldata: StrategyBuildContext["fetchPendleCalldata"] =
      async (params) =>
        this.pendleService.fetchPtSwap({
          receiver: this.config.pendleAdapter,
          tokenIn: params.tokenIn,
          amountIn: params.fromAmount,
          ptToken: params.tokenOut,
          slippage: params.slippage,
        });

    const ctx: StrategyBuildContext = {
      walletAddress,
      config: this.config,
      morphoMarkets,
      oraclePrices,
      existingPositions,
      netInputAmount: netInput,
      fetchSwapCalldata,
      fetchPendleCalldata,
    };

    // inputAmount stays GROSS: the executor pulls it from the user (executeStrategy
    // arg + approval), then skims the fee internally. netInputAmount (in ctx) is
    // what the projection/entry-sizing use.
    const strategyIntent: StrategyIntent = {
      action: "strategy",
      inputToken: intent.inputToken,
      inputAmount: inputAmount.toString(),
      steps: resolvedSteps,
    };

    const result = await this.strategyBuilder.build(strategyIntent, ctx);

    // Two independent on-chain reads (Morpho authorization status, input-token
    // allowance) — neither depends on the other's result, run concurrently.
    const [setupTxs, coreTxs] = await Promise.all([
      // Drop the Morpho `setAuthorization` tx when the adapter is already authorized.
      this.filterAuthorizationTxs(result.setupTxs, walletAddress),
      // Drop the input-token approve when the executor already has enough allowance.
      this.filterApprovalTx(
        result.transactions,
        intent.inputToken as Address,
        inputAmount,
        walletAddress,
      ),
    ]);

    const totalSteps = resolvedSteps.length;
    const loopCount = resolvedSteps.filter((s) => s.action === "borrow").length;
    const ltvPct = ((intent.targetLtv ?? 0) * 100).toFixed(0);
    const allTransactions = [...setupTxs, ...coreTxs];
    const description = `Execute ${totalSteps}-step strategy (${loopCount} borrow${loopCount === 1 ? "" : "s"} at ${ltvPct}% LTV)`;

    const apy = await this.computeApy(
      resolvedSteps,
      morphoMarkets,
      oraclePrices,
      result.projection,
      log,
    );

    return { transactions: allTransactions, description, apy };
  }

  // Compute net APY and leverage across EVERY market in the strategy, plus idle
  // (borrowed-but-not-redeployed) cash. Returns undefined when no resolver is wired or the
  // strategy touches no Morpho market. netApy is withheld unless every needed rate is ok.
  private async computeApy(
    steps: StrategyStep[],
    morphoMarkets: Map<string, MorphoMarketParams>,
    oraclePrices: Map<string, bigint>,
    projection: {
      collateral: Map<string, bigint>;
      debt: Map<string, bigint>;
      balances: Map<string, bigint>;
    },
    log?: FortressLogger,
  ): Promise<StrategyApy | undefined> {
    if (!this.apyResolver) return undefined;

    // Every market that ends the strategy holding collateral and/or debt.
    const marketIds = new Set<string>([
      ...projection.collateral.keys(),
      ...projection.debt.keys(),
    ]);
    if (marketIds.size === 0) return undefined;

    // Validate every market/price up front, in original order — bail before
    // resolving any rates at all if any one of them is missing, matching the
    // original all-or-nothing behavior without wasting the (now-concurrent)
    // resolve() calls below on a request we're going to discard anyway.
    const orderedIds = [...marketIds];
    const legInputs = orderedIds.map((id) => {
      const market = morphoMarkets.get(id);
      const oraclePrice = oraclePrices.get(id);
      const collateralRaw = projection.collateral.get(id) ?? 0n;
      const debtRaw = projection.debt.get(id) ?? 0n;
      return {
        id,
        market,
        oraclePrice,
        collateralValue: oraclePrice
          ? Number((collateralRaw * oraclePrice) / ORACLE_PRICE_SCALE)
          : 0,
        debtValue: Number(debtRaw),
      };
    });
    if (legInputs.some((l) => !l.market || l.oraclePrice === undefined || l.oraclePrice === 0n)) {
      return undefined;
    }

    // First market (in original order) carrying debt — computed directly from
    // the synchronous projection data, so it no longer depends on resolving
    // rates in sequence to observe iteration order.
    const primaryBorrowMarketId = legInputs.find((l) => l.debtValue > 0)?.id;

    // Resolve each distinct rate exactly once, all concurrently: one borrow
    // resolve per market carrying debt, one staking resolve per distinct
    // collateral token actually held (markets sharing a collateral token
    // share its resolve() call, same dedup the old sequential cache gave).
    type Resolved = Awaited<ReturnType<ApyResolverPort["resolve"]>>;
    const borrowMarketsNeeded = legInputs.filter((l) => l.debtValue > 0);
    const collateralTokensNeeded = [
      ...new Map(
        legInputs
          .filter((l) => l.collateralValue > 0)
          .map((l) => [l.market!.collateralToken.toLowerCase(), l.market!.collateralToken]),
      ).values(),
    ];

    const [borrowResults, stakingResults] = await Promise.all([
      Promise.all(
        borrowMarketsNeeded.map(async (l): Promise<[string, Resolved]> => [
          l.id,
          await this.apyResolver!.resolve({
            kind: "morpho",
            chainId: this.config.chainId,
            marketKey: computeMarketId(l.market!),
            name: `${l.market!.collateralToken}/${l.market!.loanToken}`,
          }),
        ]),
      ),
      Promise.all(
        collateralTokensNeeded.map(async (token): Promise<[string, Resolved]> => [
          token.toLowerCase(),
          await this.apyResolver!.resolve({
            kind: "staking",
            chainId: this.config.chainId,
            token,
            name: `${token} staking`,
          }),
        ]),
      ),
    ]);
    const borrowByMarket = new Map(borrowResults);
    const stakingByToken = new Map(stakingResults);

    const legs: Array<StrategyLeg & StrategyLegRates> = legInputs.map((l) => {
      const market = l.market!;
      const borrowResolved = borrowByMarket.get(l.id) ?? null;
      const collateralResolved =
        l.collateralValue > 0 ? stakingByToken.get(market.collateralToken.toLowerCase()) ?? null : null;

      return {
        marketKey: l.id,
        marketKeyHash: computeMarketId(market),
        collateralToken: market.collateralToken,
        collateralValue: l.collateralValue,
        debtValue: l.debtValue,
        collateralApy: collateralResolved?.rates?.supplyApy ?? null,
        collateralStatus: collateralResolved?.status ?? "ok",
        borrowApy: borrowResolved?.rates?.borrowApy ?? null,
        borrowStatus: borrowResolved?.status ?? "ok",
        rewardsApy: borrowResolved?.rates?.rewardsApy ?? 0,
      };
    });

    const loanTokenKeys = new Set<string>();
    for (const id of marketIds) {
      const m = morphoMarkets.get(id);
      if (m && (projection.debt.get(id) ?? 0n) > 0n) {
        loanTokenKeys.add(m.loanToken.toLowerCase());
      }
    }
    let idleCash = 0;
    for (const key of loanTokenKeys) {
      idleCash += Number(projection.balances.get(key) ?? 0n);
    }

    const agg = aggregateStrategyApy(legs, idleCash);

    const primaryMarket = primaryBorrowMarketId
      ? morphoMarkets.get(primaryBorrowMarketId)
      : undefined;

    const collateralApy: ApyTerm = {
      value: agg.collateralApy,
      status: agg.status,
      source: "staking",
      token: primaryMarket?.collateralToken ?? legs[0]?.collateralToken,
      updatedAt: new Date().toISOString(),
    };
    const borrowApy: ApyTerm = {
      value: agg.borrowApy,
      status: agg.status,
      source: "morpho",
      market: primaryBorrowMarketId,
      updatedAt: new Date().toISOString(),
    };

    const stepApys: StepApy[] = steps.map((step, index) => {
      if (step.action === "supplyCollateral") {
        return {
          index,
          action: step.action,
          apy: collateralApy.value,
          kind: "earn",
          status: agg.status,
        };
      }
      if (step.action === "borrow") {
        return {
          index,
          action: step.action,
          apy: borrowApy.value,
          kind: "cost",
          status: agg.status,
        };
      }
      return {
        index,
        action: step.action,
        apy: 0,
        kind: "neutral",
        status: "ok",
      };
    });

    return {
      status: agg.status,
      asOf: new Date().toISOString(),
      leverage: agg.leverage,
      collateralApy,
      borrowApy,
      baseApy: agg.collateralApy,
      netApy: { value: agg.netApy, status: agg.status },
      steps: stepApys,
      collateralToken: primaryMarket?.collateralToken,
      borrowMarketKey: primaryMarket
        ? computeMarketId(primaryMarket)
        : undefined,
      snapshot: {
        legs: legs.map((l) => ({
          marketKey: l.marketKey,
          marketKeyHash: l.marketKeyHash,
          collateralToken: l.collateralToken,
          collateralValue: l.collateralValue,
          debtValue: l.debtValue,
        })),
        idleCash,
      },
    };
  }

  /**
   * Removes the leading input-token approve tx when the executor already holds
   * sufficient on-chain allowance. The builder prepends `[approve, execute]`;
   * this strips the approve when redundant. Falls back to keeping it if the
   * on-chain read fails, so a flaky RPC never blocks a valid strategy.
   */
  async filterApprovalTx(
    transactions: EvmTransaction[],
    inputToken: Address,
    inputAmount: bigint,
    walletAddress: Address,
  ): Promise<EvmTransaction[]> {
    if (transactions.length < 2) return transactions;

    try {
      const client = createPublicClient({
        chain: base,
        transport: http(this.config.rpcUrl),
      });
      const allowance = await client.readContract({
        address: inputToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [walletAddress, this.config.strategyExecutor],
      });
      if (allowance >= inputAmount) return transactions.slice(1);
    } catch {
      return transactions;
    }

    return transactions;
  }

  /**
   * Removes the Morpho `setAuthorization` setup tx when the adapter is already
   * authorized on-chain for the user. Falls back to keeping the tx if the
   * on-chain read fails, so a flaky RPC never blocks a valid strategy.
   */
  async filterAuthorizationTxs(
    setupTxs: EvmTransaction[],
    walletAddress: Address,
  ): Promise<EvmTransaction[]> {
    if (setupTxs.length === 0) return setupTxs;

    let authorized = false;
    try {
      const client = createPublicClient({
        chain: base,
        transport: http(this.config.rpcUrl),
      });
      authorized = await client.readContract({
        address: this.config.morphoBlue,
        abi: morphoBlueAbi,
        functionName: "isAuthorized",
        args: [walletAddress, this.config.morphoAdapter],
      });
    } catch {
      return setupTxs;
    }

    return authorized ? [] : setupTxs;
  }

  // Fetch user account balance for the input token he/she demanded
  async resolveInputAmount(
    token: Address,
    rawAmount: string,
    walletAddress: Address,
  ): Promise<bigint> {
    const declared = BigInt(rawAmount);
    if (declared > 0n) return declared;

    const client = createPublicClient({ chain: base, transport: http(this.config.rpcUrl) });
    const balance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    });

    if (balance === 0n) {
      throw new Error(
        `Wallet holds no ${token} to execute the strategy. Fund the wallet or specify an explicit amount.`,
      );
    }
    return balance;
  }

  /**
   * Backend safety net: if the LLM emitted `loops: N` but only wrote the loop
   * body once (or fewer than N times), expand the borrow→…→supply block so the
   * steps array is fully flat. Mutates `intent.steps` in place.
   *
   * Detection: count borrow steps. If borrowCount < loops, find the loop body
   * (first borrow through the next supplyCollateral) and repeat it.
   */
  private expandLoopsIfNeeded(
    intent: Extract<Intent, { action: "strategy" }>,
  ): void {
    const loops = intent.loops ?? 1;
    if (loops <= 1) return;

    const steps = intent.steps;
    const borrowCount = steps.filter((s) => s.action === "borrow").length;

    // Already fully expanded
    if (borrowCount >= loops) return;

    // Find the first borrow index — everything before it is the "entry" block
    const firstBorrowIdx = steps.findIndex((s) => s.action === "borrow");
    if (firstBorrowIdx < 0) return; // No borrow at all, nothing to expand

    // The loop body is from the first borrow to the next supplyCollateral (inclusive)
    let loopEnd = firstBorrowIdx;
    for (let i = firstBorrowIdx + 1; i < steps.length; i++) {
      loopEnd = i;
      if (steps[i].action === "supplyCollateral") break;
    }

    const loopBody = steps.slice(firstBorrowIdx, loopEnd + 1);
    const entryBlock = steps.slice(0, firstBorrowIdx);

    // Rebuild: entry + loopBody × loops
    const expanded = [...entryBlock];
    for (let i = 0; i < loops; i++) {
      // Deep-clone each step so mutations don't leak between iterations
      expanded.push(...loopBody.map((s) => JSON.parse(JSON.stringify(s))));
    }

    intent.steps = expanded;
  }

  /**
   * Backend safety net: infers a missing `protocolData.marketId` on a Morpho
   * step (supplyCollateral/borrow/repay/withdrawCollateral). Mutates
   * `intent.steps` in place.
   *
   * Two passes, since the model can drop marketId on ANY occurrence — not
   * just later loop repetitions, sometimes the very first (entry) step:
   *   1. Collect every distinct marketId actually set anywhere in the intent.
   *   2. If exactly one distinct value is used, backfill every Morpho step
   *      missing one with it — correct for the overwhelming common case of a
   *      single-market strategy, regardless of which occurrence the model
   *      happened to set it on. If zero or multiple distinct values are
   *      present, there's nothing safe to infer, so leave it to fail
   *      validation with its real error rather than guess.
   *
   * Pendle-collateral steps are skipped (their marketId is deliberately unset
   * here — resolvePendleMarkets fills it in afterward from `pendleMarket`).
   */
  private fillMissingMarketIds(
    intent: Extract<Intent, { action: "strategy" }>,
  ): void {
    const MORPHO_STEP_ACTIONS = new Set([
      "supplyCollateral",
      "borrow",
      "repay",
      "withdrawCollateral",
    ]);

    const morphoSteps = intent.steps.filter(
      (s) => MORPHO_STEP_ACTIONS.has(s.action) && !s.protocolData?.pendleMarket,
    );

    const distinctMarketIds = new Set(
      morphoSteps.map((s) => s.protocolData?.marketId).filter((id): id is string => Boolean(id)),
    );
    if (distinctMarketIds.size !== 1) return;
    const [onlyMarketId] = distinctMarketIds;

    for (const step of morphoSteps) {
      if (!step.protocolData?.marketId) {
        if (!step.protocolData) (step as StrategyStep).protocolData = {};
        step.protocolData!.marketId = onlyMarketId;
      }
    }
  }
}
