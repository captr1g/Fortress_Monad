
import { encodeFunctionData, encodeAbiParameters, Address } from "viem";
import type { EvmTransaction } from "../types.js";
import type {
  StrategyIntent,
  StrategyStep,
  StrategyBuildResult,
  StrategyBuildContext,
} from "@domains/yield/types/strategy.js";

import type {
  ProjectedState,
  OnChainStep,
} from "@domains/yield/types/market.js";

import {
  erc20Abi,
  strategyExecutorAbi,
  marketParamsAbiType,
  marketParamsWithAmountAbiType,
  borrowDataAbiType,
  swapDataAbiType,
  pendleDataAbiType,
  pendleWrapDataAbiType,
  setAuth,
} from "../config/abi.js";
import { ORACLE_PRICE_SCALE, WAD } from "./pricing.js";
import { ltvToWad } from "../helper/utils.js";

// ActionType enum matching the contract
const ACTION_TYPE = {
  swap: 0,
  supplyCollateral: 1,
  borrow: 2,
  repay: 3,
  withdrawCollateral: 4,
  depositErc4626: 5,
  redeemErc4626: 6,
} as const;

// Adapter IDs
const ADAPTER_ID = {
  swap: 0,
  morpho: 1,
  pendle: 2,
} as const;

//Headroom added above the expected borrow when computing the on-chain ceiling.
const BORROW_CEILING_PADDING_BPS = 300n; // +3%
// Fraction of the expected borrow below which a borrow is treated as dust.
const BORROW_MIN_FLOOR_BPS = 100n; // 1% of the projected borrow
// Exact approval — approve only the inputAmount the executor needs for this tx.
// No residual allowance remains after execution, limiting blast radius if the
// executor contract is ever maliciously upgraded.

export class StrategyBuilder {
  async build(
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
  ): Promise<StrategyBuildResult> {
    // Gross input: what the executor pulls from the user (executeStrategy arg + approval).
    const inputAmount = BigInt(intent.inputAmount);
    // Net input: what the executor actually holds after skimming its fee. All balance
    // projection + swap sizing is done off net so baked amounts match on-chain.
    const netInput = ctx.netInputAmount ?? inputAmount;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const state: ProjectedState = {
      balances: new Map([[intent.inputToken.toLowerCase(), netInput]]),
      collateral: new Map(),
      debt: new Map(),
    };

    // compute exisiting positions of the user
    if (ctx.existingPositions) {
      for (const [marketId, pos] of ctx.existingPositions) {
        if (pos.collateral > 0n) state.collateral.set(marketId, pos.collateral);
        if (pos.debt > 0n) state.debt.set(marketId, pos.debt);
      }
    }

    // Swap quotes are fetched sequentially so each swap is sized off the REAL output
    // of the previous one (LiFi expectedOut), not a guessed estimate. This is required
    // for chained swaps across different decimals (e.g. USDC→WETH→cbETH).
    const quoteByStep = new Map<
      number,
      { dex: Address; calldata: Address; expectedOut: bigint }
    >();
    const pendleQuoteByStep = new Map<
      number,
      { calldata: Address; expectedOut: bigint }
    >();

    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i];
      if (step.action === "swap") {
        const tokenOut = (step.tokenOut ?? intent.inputToken) as Address;
        const slippage = step.protocolData?.slippage ?? 0.005; // will change to dynamic once we launch it
        const tokenInKey = step.tokenIn.toLowerCase();

        // Size the swap input: a fixed amount, else the bps fraction of the current
        // balance (bps 10000 = 100%). This mirrors the on-chain executor, which sends
        // the adapter balance*bps/10000, so the baked LiFi fromAmount matches.
        const available =
          state.balances.get(tokenInKey) ?? BigInt(intent.inputAmount);
        const consumed = step.amountFixed
          ? BigInt(step.amountFixed)
          : (available * BigInt(step.bps)) / 10000n;

        // For useFullBalance swaps (post-borrow / chained) the real on-chain input
        // may be slightly under the estimate, so quote at 95% to keep the baked-in
        // fromAmount ≤ the actual balance LiFi's requiresDeposit path transfers.
        const useFullBalance = step.protocolData?.useFullBalance ?? false;
        const quoteAmount = useFullBalance ? (consumed * 95n) / 100n : consumed;

        const quote = await ctx.fetchSwapCalldata({
          fromToken: step.tokenIn as Address,
          toToken: tokenOut,
          fromAmount: quoteAmount,
          fromAddress: ctx.config.swapAdapter,
          slippage,
        });
        quoteByStep.set(i, quote);

        // Project balances off the real quote output, not a price estimate.
        this.adjustBalance(state, tokenInKey, -consumed);
        this.adjustBalance(state, tokenOut.toLowerCase(), quote.expectedOut);
      } else if (
        step.action === "swapToPt" ||
        step.action === "swapToYt" ||
        step.action === "addLiquidityPendle"
      ) {
        const outToken = step.tokenOut as Address;
        if (!outToken)
          throw new Error(`${step.action} step requires a resolved tokenOut`);
        const slippage = step.protocolData?.slippage ?? 0.005;
        const tokenInKey = step.tokenIn.toLowerCase();

        const available =
          state.balances.get(tokenInKey) ?? BigInt(intent.inputAmount);
        const consumed = step.amountFixed
          ? BigInt(step.amountFixed)
          : (available * BigInt(step.bps)) / 10000n;

        const useFullBalance = step.protocolData?.useFullBalance ?? false;
        const quoteAmount = useFullBalance ? (consumed * 95n) / 100n : consumed;

        const quote = await ctx.fetchPendleCalldata({
          tokenIn: step.tokenIn as Address,
          tokenOut: outToken,
          fromAmount: quoteAmount,
          slippage,
        });
        pendleQuoteByStep.set(i, quote);

        this.adjustBalance(state, tokenInKey, -consumed);
        this.adjustBalance(state, outToken.toLowerCase(), quote.expectedOut);
      } else if (step.action === "supplyCollateral") {
        // Infer marketId from collateral token if the LLM omitted it.
        let marketId = step.protocolData?.marketId;
        if (!marketId) {
          const tokenIn = step.tokenIn.toLowerCase();
          for (const [label, mkt] of ctx.morphoMarkets) {
            if (mkt.collateralToken.toLowerCase() === tokenIn) {
              marketId = label;
              break;
            }
          }
          if (!marketId) {
            throw new Error(
              `Step ${i} (supplyCollateral) is missing a market. Name the Morpho market, e.g. "cbETH-USDC".`,
            );
          }
        }
        const tokenInKey = step.tokenIn.toLowerCase();
        const supplied = step.amountFixed
          ? BigInt(step.amountFixed)
          : (state.balances.get(tokenInKey) ?? 0n);
        this.adjustBalance(state, tokenInKey, -supplied);
        this.addToMarket(state.collateral, marketId, supplied);
      } else if (step.action === "borrow") {
        const marketId = step.protocolData?.marketId;
        if (!marketId)
          throw new Error("borrow step requires protocolData.marketId");
        const targetLtv = step.protocolData?.targetLtv;
        if (targetLtv === undefined)
          throw new Error("borrow step requires protocolData.targetLtv");
        const market = ctx.morphoMarkets.get(marketId);
        if (!market)
          throw new Error(`Market ${marketId} not found in registry`);
        const oraclePrice = ctx.oraclePrices.get(marketId);
        if (oraclePrice === undefined || oraclePrice === 0n)
          throw new Error(`Missing oracle price for market ${marketId}`);
        const targetLtvWad = ltvToWad(targetLtv);
        const expectedCollateral = state.collateral.get(marketId) ?? 0n;
        const collateralValue =
          (expectedCollateral * oraclePrice) / ORACLE_PRICE_SCALE;
        const targetDebt = (collateralValue * targetLtvWad) / WAD;
        const currentDebt = state.debt.get(marketId) ?? 0n;
        const incrementalBorrow =
          targetDebt > currentDebt ? targetDebt - currentDebt : 0n;
        state.debt.set(marketId, targetDebt);
        this.adjustBalance(
          state,
          market.loanToken.toLowerCase(),
          incrementalBorrow,
        );
      }
    }

    const encodeState: ProjectedState = {
      balances: new Map([[intent.inputToken.toLowerCase(), netInput]]),
      collateral: new Map(),
      debt: new Map(),
    };
    if (ctx.existingPositions) {
      for (const [marketId, pos] of ctx.existingPositions) {
        if (pos.collateral > 0n)
          encodeState.collateral.set(marketId, pos.collateral);
        if (pos.debt > 0n) encodeState.debt.set(marketId, pos.debt);
      }
    }

    const onChainSteps: OnChainStep[] = [];
    for (let i = 0; i < intent.steps.length; i++) {
      const step = intent.steps[i];
      const built = await this.buildStepWithQuote(
        step,
        i,
        intent,
        ctx,
        encodeState,
        quoteByStep,
        pendleQuoteByStep,
      );
      onChainSteps.push(built);
    }

    // Compute sweep tokens: the contract already sweeps inputToken, each step's
    // tokenIn, and each step's tokenOut. The sweepTokens param is a safety net for
    // tokens that might only appear as intermediate outputs (e.g. borrowed loan tokens,
    // collateral tokens from withdrawals). We collect all known output tokens plus
    // loan/collateral tokens from referenced Morpho markets, deduplicate, and exclude
    // inputToken (already swept by the contract).
    const sweepSet = new Set<string>();
    for (const step of intent.steps) {
      if (step.tokenOut) sweepSet.add(step.tokenOut.toLowerCase());
    }
    // Add loan and collateral tokens from every Morpho market the strategy touches.
    if (ctx.morphoMarkets) {
      for (const market of ctx.morphoMarkets.values()) {
        sweepSet.add(market.loanToken.toLowerCase());
        sweepSet.add(market.collateralToken.toLowerCase());
      }
    }
    // Remove inputToken (the contract sweeps it natively).
    sweepSet.delete(intent.inputToken.toLowerCase());
    // Also remove tokens that are already a step's tokenIn (contract sweeps those too).
    for (const step of intent.steps) {
      sweepSet.delete(step.tokenIn.toLowerCase());
    }
    const sweepTokens = [...sweepSet] as Address[];

    const executeCalldata = encodeFunctionData({
      abi: strategyExecutorAbi,
      functionName: "executeStrategy",
      args: [
        intent.inputToken as Address,
        inputAmount,
        onChainSteps.map((s) => ({
          adapterId: s.adapterId,
          action: s.action,
          tokenIn: s.tokenIn,
          bps: s.bps,
          amountFixed: s.amountFixed,
          data: s.data,
        })),
        sweepTokens,
        deadline,
      ],
    });

    const executeTx: EvmTransaction = {
      to: ctx.config.strategyExecutor,
      data: executeCalldata,
      value: 0n,
      chainId: ctx.config.chainId,
    };

    // approve tx — exact amount only (no residual allowance after execution)
    const approveTx: EvmTransaction = {
      to: intent.inputToken as Address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ctx.config.strategyExecutor, inputAmount],
      }),
      value: 0n,
      chainId: ctx.config.chainId,
    };

    // Morpho authorization setup tx (pruned by the service if already authorized).
    const setupTxs: EvmTransaction[] = [];
    const hasMorphoSteps = intent.steps.some(
      (s) =>
        s.action === "supplyCollateral" ||
        s.action === "borrow" ||
        s.action === "repay" ||
        s.action === "withdrawCollateral",
    );

    if (hasMorphoSteps) {
      const morphoSetAuthCalldata = encodeFunctionData({
        abi: setAuth,
        functionName: "setAuthorization",
        args: [ctx.config.morphoAdapter, true],
      });

      setupTxs.push({
        to: ctx.config.morphoBlue,
        data: morphoSetAuthCalldata,
        value: 0n,
        chainId: ctx.config.chainId,
      });
    }

    const stepCount = intent.steps.length;
    const description = `Execute ${stepCount}-step strategy via FortStrategyExecutor`;

    return {
      transactions: [approveTx, executeTx],
      description,
      setupTxs,
      projection: {
        collateral: encodeState.collateral,
        debt: encodeState.debt,
        balances: encodeState.balances,
      },
    };
  }

  /**
   * Encode a single step using a pre-fetched swap quote (if it's a swap step).
   * Updates encodeState as it goes.
   */
  private async buildStepWithQuote(
    step: StrategyStep,
    stepIndex: number,
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
    state: ProjectedState,
    quoteByStep: Map<
      number,
      { dex: Address; calldata: Address; expectedOut: bigint }
    >,
    pendleQuoteByStep: Map<
      number,
      { calldata: Address; expectedOut: bigint }
    >,
  ): Promise<OnChainStep> {
    switch (step.action) {
      case "swap":
        return this.buildSwapStepFromQuote(
          step,
          stepIndex,
          intent,
          ctx,
          state,
          quoteByStep,
        );
      case "swapToPt":
      case "swapToYt":
      case "addLiquidityPendle":
        return this.buildPendleStepFromQuote(
          step,
          stepIndex,
          intent,
          state,
          pendleQuoteByStep,
        );
      case "wrapLp":
        return this.buildWrapLpStep(step, state);
      case "supplyCollateral":
        return this.buildSupplyStep(step, ctx, state);
      case "borrow":
        return this.buildBorrowStep(step, ctx, state);
      case "repay":
        return this.buildRepayStep(step, ctx);
      case "withdrawCollateral":
        return this.buildWithdrawStep(step, ctx);
    }
  }

  private buildSwapStepFromQuote(
    step: StrategyStep,
    stepIndex: number,
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
    state: ProjectedState,
    quoteByStep: Map<
      number,
      { dex: Address; calldata: Address; expectedOut: bigint }
    >,
  ): OnChainStep {
    const tokenOut = (step.tokenOut ?? intent.inputToken) as Address;
    const tokenInKey = step.tokenIn.toLowerCase();

    const swapResult = quoteByStep.get(stepIndex);
    if (!swapResult)
      throw new Error(`No pre-fetched swap quote for step ${stepIndex}`);

    const minOut = step.protocolData?.minAmountOut
      ? BigInt(step.protocolData.minAmountOut)
      : (swapResult.expectedOut * 95n) / 100n;

    const useFullBalance = step.protocolData?.useFullBalance ?? false;

    const data = encodeAbiParameters(swapDataAbiType, [
      swapResult.dex,
      tokenOut,
      minOut,
      useFullBalance,
      swapResult.calldata,
    ]);

    // Update projected balances: consume the bps fraction (or fixed amount) of the
    // current balance, matching the on-chain executor's sizing.
    const available =
      state.balances.get(tokenInKey) ?? BigInt(intent.inputAmount);
    const consumed = step.amountFixed
      ? BigInt(step.amountFixed)
      : (available * BigInt(step.bps)) / 10000n;
    this.adjustBalance(state, tokenInKey, -consumed);
    this.adjustBalance(state, tokenOut.toLowerCase(), swapResult.expectedOut);

    return {
      adapterId: ADAPTER_ID.swap,
      action: ACTION_TYPE.swap,
      tokenIn: step.tokenIn as Address,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as Address,
    };
  }

  private buildPendleStepFromQuote(
    step: StrategyStep,
    stepIndex: number,
    intent: StrategyIntent,
    state: ProjectedState,
    pendleQuoteByStep: Map<
      number,
      { calldata: Address; expectedOut: bigint }
    >,
  ): OnChainStep {
    const outToken = step.tokenOut as Address;
    if (!outToken)
      throw new Error(`${step.action} step requires a resolved tokenOut`);

    const quote = pendleQuoteByStep.get(stepIndex);
    if (!quote)
      throw new Error(`No pre-fetched Pendle quote for step ${stepIndex}`);

    const minOut = step.protocolData?.minAmountOut
      ? BigInt(step.protocolData.minAmountOut)
      : (quote.expectedOut * 95n) / 100n;

    const useFullBalance = step.protocolData?.useFullBalance ?? false;

    // Pendle adapter data: (uint8 subAction=0, tokenOut, minAmountOut, useFullBalance, routerCalldata).
    const data = encodeAbiParameters(pendleDataAbiType, [
      0,
      outToken,
      minOut,
      useFullBalance,
      quote.calldata,
    ]);

    const tokenInKey = step.tokenIn.toLowerCase();
    const available =
      state.balances.get(tokenInKey) ?? BigInt(intent.inputAmount);
    const consumed = step.amountFixed
      ? BigInt(step.amountFixed)
      : (available * BigInt(step.bps)) / 10000n;
    this.adjustBalance(state, tokenInKey, -consumed);
    this.adjustBalance(state, outToken.toLowerCase(), quote.expectedOut);

    return {
      adapterId: ADAPTER_ID.pendle,
      action: ACTION_TYPE.swap,
      tokenIn: step.tokenIn as Address,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as Address,
    };
  }

  private buildWrapLpStep(
    step: StrategyStep,
    state: ProjectedState,
  ): OnChainStep {
    const wrapper = step.protocolData?.dex as Address | undefined;
    const wrappedToken = step.tokenOut as Address | undefined;
    if (!wrapper || !wrappedToken)
      throw new Error(
        "wrapLp step requires protocolData.dex (wrapper address) and tokenOut (wrapped LP address)",
      );

    // Wrap consumes the full LP balance and produces 1:1 wrapped LP.
    const tokenInKey = step.tokenIn.toLowerCase();
    const lpBalance = state.balances.get(tokenInKey) ?? 0n;
    this.adjustBalance(state, tokenInKey, -lpBalance);
    this.adjustBalance(state, wrappedToken.toLowerCase(), lpBalance);

    const data = encodeAbiParameters(pendleWrapDataAbiType, [
      1, // sub-action 1 = wrap LP
      wrapper,
      wrappedToken,
    ]);

    return {
      adapterId: ADAPTER_ID.pendle,
      action: ACTION_TYPE.swap,
      tokenIn: step.tokenIn as Address,
      bps: 10000,
      amountFixed: 0n,
      data: data as Address,
    };
  }

  private buildSupplyStep(
    step: StrategyStep,
    ctx: StrategyBuildContext,
    state: ProjectedState,
  ): OnChainStep {
    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new Error("supplyCollateral step requires protocolData.marketId");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsAbiType, [market]);

    // Projected: the supplied collateral leaves the executor and joins the position.
    const tokenInKey = step.tokenIn.toLowerCase();
    const supplied = step.amountFixed
      ? BigInt(step.amountFixed)
      : (state.balances.get(tokenInKey) ?? 0n);
    this.adjustBalance(state, tokenInKey, -supplied);
    this.addToMarket(state.collateral, marketId, supplied);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.supplyCollateral,
      tokenIn: step.tokenIn as Address,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as Address,
    };
  }

  private buildBorrowStep(
    step: StrategyStep,
    ctx: StrategyBuildContext,
    state: ProjectedState,
  ): OnChainStep {
    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new Error("borrow step requires protocolData.marketId");

    const targetLtv = step.protocolData?.targetLtv;
    if (targetLtv === undefined)
      throw new Error("borrow step requires protocolData.targetLtv");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const oraclePrice = ctx.oraclePrices.get(marketId);
    if (oraclePrice === undefined || oraclePrice === 0n)
      throw new Error(`Missing oracle price for market ${marketId}`);

    const targetLtvWad = ltvToWad(targetLtv);

    // Project the on-chain sizing so we can (a) set a safe ceiling and (b) estimate
    // the borrowed amount for the following swap's LiFi quote. The CONTRACT does the
    // authoritative sizing from live collateral; these are only estimates.
    const expectedCollateral = state.collateral.get(marketId) ?? 0n;
    const collateralValue =
      (expectedCollateral * oraclePrice) / ORACLE_PRICE_SCALE;
    const targetDebt = (collateralValue * targetLtvWad) / WAD;
    const currentDebt = state.debt.get(marketId) ?? 0n;
    const incrementalBorrow =
      targetDebt > currentDebt ? targetDebt - currentDebt : 0n;

    // Ceiling: prefer an explicit planner value, else pad the projected borrow.
    const maxBorrow = step.protocolData?.borrowCeiling
      ? BigInt(step.protocolData.borrowCeiling)
      : (incrementalBorrow * (10000n + BORROW_CEILING_PADDING_BPS)) / 10000n;

    // Dust floor: a small fraction of the projected borrow. Below this the on-chain
    // gap is not worth a micro-swap. Zero when we can't project a borrow (the adapter
    // will still reject a truly empty borrow via NothingToBorrow).
    const minBorrow = (incrementalBorrow * BORROW_MIN_FLOOR_BPS) / 10000n;

    const data = encodeAbiParameters(borrowDataAbiType, [
      market,
      targetLtvWad,
      maxBorrow,
      minBorrow,
    ]);

    // Projected: debt rises to target; borrowed loan token lands in the executor.
    state.debt.set(marketId, targetDebt);
    this.adjustBalance(
      state,
      market.loanToken.toLowerCase(),
      incrementalBorrow,
    );

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.borrow,
      tokenIn: step.tokenIn as Address,
      bps: 0,
      amountFixed: 0n,
      data: data as Address,
    };
  }

  private buildRepayStep(
    step: StrategyStep,
    ctx: StrategyBuildContext,
  ): OnChainStep {
    const marketId = step.protocolData?.marketId;
    if (!marketId) throw new Error("repay step requires protocolData.marketId");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsAbiType, [market]);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.repay,
      tokenIn: step.tokenIn as Address,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as Address,
    };
  }

  private buildWithdrawStep(
    step: StrategyStep,
    ctx: StrategyBuildContext,
  ): OnChainStep {
    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new Error("withdrawCollateral step requires protocolData.marketId");

    const withdrawAmount = step.protocolData?.withdrawAmount;
    if (!withdrawAmount)
      throw new Error(
        "withdrawCollateral step requires protocolData.withdrawAmount",
      );

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsWithAmountAbiType, [
      market,
      BigInt(withdrawAmount),
    ]);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.withdrawCollateral,
      tokenIn: step.tokenIn as Address,
      bps: 0,
      amountFixed: 0n,
      data: data as Address,
    };
  }

  private adjustBalance(
    state: ProjectedState,
    tokenKey: string,
    delta: bigint,
  ): void {
    const next = (state.balances.get(tokenKey) ?? 0n) + delta;
    state.balances.set(tokenKey, next > 0n ? next : 0n);
  }

  private addToMarket(
    map: Map<string, bigint>,
    marketId: string,
    delta: bigint,
  ): void {
    map.set(marketId, (map.get(marketId) ?? 0n) + delta);
  }
}
