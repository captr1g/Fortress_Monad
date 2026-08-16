import { encodeFunctionData, encodeAbiParameters } from "viem";
import type { StrategyIntent, StrategyStep } from "../types/strategy.js";
import type { FortressConfig } from "../utils/config.js";
import type { UnsignedTransaction } from "../helpers/builder.js";
import { erc20Abi } from "../utils/abi.js";

// FortStrategyExecutor ABI (only what we need)
const strategyExecutorAbi = [
  {
    name: "executeStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      {
        name: "steps",
        type: "tuple[]",
        components: [
          { name: "adapterId", type: "uint8" },
          { name: "action", type: "uint8" },
          { name: "tokenIn", type: "address" },
          { name: "bps", type: "uint16" },
          { name: "amountFixed", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// Morpho Blue MarketParams ABI encoding
const marketParamsAbiType = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
] as const;

const marketParamsWithAmountAbiType = [
  {
    type: "tuple",
    components: [
      { name: "loanToken", type: "address" },
      { name: "collateralToken", type: "address" },
      { name: "oracle", type: "address" },
      { name: "irm", type: "address" },
      { name: "lltv", type: "uint256" },
    ],
  },
  { type: "uint256" },
] as const;

// Swap data ABI encoding: (address dex, address tokenOut, uint256 minAmountOut, bytes swapCalldata)
const swapDataAbiType = [
  { type: "address" },
  { type: "address" },
  { type: "uint256" },
  { type: "bytes" },
] as const;

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

// Adapter IDs (configured on-chain via registerAdapter)
const ADAPTER_ID = {
  swap: 0,
  morpho: 1,
} as const;

export type MorphoMarketParams = {
  loanToken: `0x${string}`;
  collateralToken: `0x${string}`;
  oracle: `0x${string}`;
  irm: `0x${string}`;
  lltv: bigint;
};

export type MorphoInOut = {
  collateralToken: `0x${string}`;
  loanToken: `0x${string}`;
};

export type StrategyBuildContext = {
  walletAddress: `0x${string}`;
  config: FortressConfig;
  morphoMarkets: Map<string, MorphoMarketParams>;
  fetchSwapCalldata: (params: {
    fromToken: `0x${string}`;
    toToken: `0x${string}`;
    fromAmount: bigint;
    fromAddress: `0x${string}`;
    slippage: number;
  }) => Promise<{
    dex: `0x${string}`;
    calldata: `0x${string}`;
    expectedOut: bigint;
  }>;
};

export type StrategyBuildResult = {
  transactions: UnsignedTransaction[];
  description: string;
  setupTxs: UnsignedTransaction[];
};

export class StrategyBuilder {
  async build(
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
  ): Promise<StrategyBuildResult> {
    const inputAmount = BigInt(intent.inputAmount);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    // Build on-chain Step[] from the intent steps
    const onChainSteps: Array<{
      adapterId: number;
      action: number;
      tokenIn: `0x${string}`;
      bps: number;
      amountFixed: bigint;
      data: `0x${string}`;
    }> = [];

    for (const step of intent.steps) {
      const built = await this.buildStep(step, intent, ctx);
      onChainSteps.push(built);
    }

    // Encode the executeStrategy calldata
    const executeCalldata = encodeFunctionData({
      abi: strategyExecutorAbi,
      functionName: "executeStrategy",
      args: [
        intent.inputToken as `0x${string}`,
        inputAmount,
        onChainSteps.map((s) => ({
          adapterId: s.adapterId,
          action: s.action,
          tokenIn: s.tokenIn,
          bps: s.bps,
          amountFixed: s.amountFixed,
          data: s.data,
        })),
        deadline,
      ],
    });

    const executeTx: UnsignedTransaction = {
      to: ctx.config.strategyExecutor,
      data: executeCalldata,
      value: 0n,
      chainId: ctx.config.chainId,
    };

    // Build approve tx for the input token
    const approveTx: UnsignedTransaction = {
      to: intent.inputToken as `0x${string}`,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [ctx.config.strategyExecutor, inputAmount],
      }),
      value: 0n,
      chainId: ctx.config.chainId,
    };

    // Check if Morpho authorization is needed (setup tx)
    const setupTxs: UnsignedTransaction[] = [];
    const hasMorphoSteps = intent.steps.some(
      (s) =>
        s.action === "supplyCollateral" ||
        s.action === "borrow" ||
        s.action === "repay" ||
        s.action === "withdrawCollateral",
    );

    if (hasMorphoSteps) {
      // Always emit the setAuthorization tx here; the service layer prunes it
      // when an on-chain isAuthorized check shows the adapter is already approved.
      const morphoSetAuthCalldata = encodeFunctionData({
        abi: [
          {
            name: "setAuthorization",
            type: "function",
            stateMutability: "nonpayable",
            inputs: [
              { name: "authorized", type: "address" },
              { name: "newIsAuthorized", type: "bool" },
            ],
            outputs: [],
          },
        ] as const,
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
    };
  }

  private async buildStep(
    step: StrategyStep,
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
  ): Promise<{
    adapterId: number;
    action: number;
    tokenIn: `0x${string}`;
    bps: number;
    amountFixed: bigint;
    data: `0x${string}`;
  }> {
    switch (step.action) {
      case "swap":
        return this.buildSwapStep(step, intent, ctx);
      case "supplyCollateral":
        return this.buildSupplyStep(step, ctx);
      case "borrow":
        return this.buildBorrowStep(step, ctx);
      case "repay":
        return this.buildRepayStep(step, ctx);
      case "withdrawCollateral":
        return this.buildWithdrawStep(step, ctx);
    }
  }

  private async buildSwapStep(
    step: StrategyStep,
    intent: StrategyIntent,
    ctx: StrategyBuildContext,
  ) {
    const tokenOut = step.tokenOut ?? intent.inputToken;
    const slippage = step.protocolData?.slippage ?? 0.005;

    // Determine the estimated amount for the LiFi quote:
    // 1. If step has amountFixed, use that
    // 2. Otherwise look at the preceding borrow step's borrowAmount (for looping strategies)
    // 3. Fall back to intent.inputAmount (first swap)
    let estimatedAmount: bigint;
    if (step.amountFixed) {
      estimatedAmount = BigInt(step.amountFixed);
    } else {
      estimatedAmount = this.estimateSwapInput(step, intent);
    }

    // LiFi rejects fromAmount=0 — ensure we have a valid amount for the quote
    if (estimatedAmount === 0n) {
      estimatedAmount = BigInt(intent.inputAmount);
    }

    const swapResult = await ctx.fetchSwapCalldata({
      fromToken: step.tokenIn as `0x${string}`,
      toToken: tokenOut as `0x${string}`,
      fromAmount: estimatedAmount,
      fromAddress: ctx.config.swapAdapter,
      slippage,
    });

    const minOut = step.protocolData?.minAmountOut
      ? BigInt(step.protocolData.minAmountOut)
      : (swapResult.expectedOut * 95n) / 100n;

    const data = encodeAbiParameters(swapDataAbiType, [
      swapResult.dex,
      tokenOut as `0x${string}`,
      minOut,
      swapResult.calldata,
    ]);

    return {
      adapterId: ADAPTER_ID.swap,
      action: ACTION_TYPE.swap,
      tokenIn: step.tokenIn as `0x${string}`,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as `0x${string}`,
    };
  }

  private buildSupplyStep(step: StrategyStep, ctx: StrategyBuildContext) {
    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new Error("supplyCollateral step requires protocolData.marketId");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsAbiType, [market]);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.supplyCollateral,
      tokenIn: step.tokenIn as `0x${string}`,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as `0x${string}`,
    };
  }

  private buildBorrowStep(step: StrategyStep, ctx: StrategyBuildContext) {
    const marketId = step.protocolData?.marketId;
    if (!marketId)
      throw new Error("borrow step requires protocolData.marketId");

    const borrowAmount = step.protocolData?.borrowAmount;
    if (!borrowAmount)
      throw new Error("borrow step requires protocolData.borrowAmount");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsWithAmountAbiType, [
      market,
      BigInt(borrowAmount),
    ]);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.borrow,
      tokenIn: step.tokenIn as `0x${string}`,
      bps: 0,
      amountFixed: 0n,
      data: data as `0x${string}`,
    };
  }

  private buildRepayStep(step: StrategyStep, ctx: StrategyBuildContext) {
    const marketId = step.protocolData?.marketId;
    if (!marketId) throw new Error("repay step requires protocolData.marketId");

    const market = ctx.morphoMarkets.get(marketId);
    if (!market) throw new Error(`Market ${marketId} not found in registry`);

    const data = encodeAbiParameters(marketParamsAbiType, [market]);

    return {
      adapterId: ADAPTER_ID.morpho,
      action: ACTION_TYPE.repay,
      tokenIn: step.tokenIn as `0x${string}`,
      bps: step.bps,
      amountFixed: step.amountFixed ? BigInt(step.amountFixed) : 0n,
      data: data as `0x${string}`,
    };
  }

  private buildWithdrawStep(step: StrategyStep, ctx: StrategyBuildContext) {
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
      tokenIn: step.tokenIn as `0x${string}`,
      bps: 0,
      amountFixed: 0n,
      data: data as `0x${string}`,
    };
  }

  /**
   * Estimates the input amount for a swap step by looking at the preceding borrow step.
   * In a leverage loop, swap steps after a borrow consume the borrowed amount.
   */
  private estimateSwapInput(
    step: StrategyStep,
    intent: StrategyIntent,
  ): bigint {
    const stepIndex = intent.steps.indexOf(step);

    // Walk backwards to find the most recent borrow step targeting the same token
    for (let i = stepIndex - 1; i >= 0; i--) {
      const prev = intent.steps[i];
      if (prev.action === "borrow" && prev.protocolData?.borrowAmount) {
        return BigInt(prev.protocolData.borrowAmount);
      }
      // Stop searching if we hit another swap (means this swap isn't after a borrow)
      if (prev.action === "swap") break;
    }

    // First swap in the strategy — use the full input amount
    return BigInt(intent.inputAmount);
  }
}
