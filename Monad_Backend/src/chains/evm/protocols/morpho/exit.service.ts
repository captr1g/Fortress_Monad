import { createPublicClient, http, encodeFunctionData, type Address } from "viem";
import { monad } from "viem/chains";
import type { EvmTransaction, EvmChainConfig } from "../../types.js";
import {
  ExitResult,
  SWAP_SLIPPAGE,
  MIN_OUT_BPS,
} from "@domains/yield/types/market.js";
import { EvmSimulator } from "../../simulator.js";
import { MorphoMarketService, readPosition } from "./morpho.service.js";
import { morphoBlueAbi, morphoExitExecutorAbi } from "../../config/abi.js";
import { computeExitAmounts } from "./exit-math.js";
import { tokenAddress } from "@core/registry/index.js";
import { fetchLiFiUnwindQuote } from "../lifi/swap-resolver.js";
import {
  EXIT_MODE_ENUM,
  type ExitMode,
  type ExitRequest,
  type ExitSettlement,
  type PositionView,
} from "@domains/yield/types/exit.js";
import type { MorphoMarketParams } from "@domains/yield/types/market.js";

export class ExitService {
  private readonly config: EvmChainConfig;
  private readonly morphoService: MorphoMarketService;
  private readonly simulator: EvmSimulator;

  constructor(config: EvmChainConfig, simulator: EvmSimulator) {
    this.config = config;
    this.morphoService = new MorphoMarketService(config.chainId);
    this.simulator = simulator;
  }

  async readPositionForMarket(
    marketRef: string,
    walletAddress: Address,
  ): Promise<PositionView> {
    const { market } = await this.resolveMarket(marketRef);
    return readPosition(
      this.config.rpcUrl,
      this.config.morphoBlue,
      market,
      marketRef,
      walletAddress,
    );
  }

  async buildExit(req: ExitRequest): Promise<ExitResult> {
    const walletAddress = req.walletAddress as Address;
    const { market } = await this.resolveMarket(req.market);

    const position = await readPosition(
      this.config.rpcUrl,
      this.config.morphoBlue,
      market,
      req.market,
      walletAddress,
    );
    if (position.debt === 0n)
      throw new Error("No open debt to exit for this market.");
    if (position.collateral === 0n)
      throw new Error("No collateral in this position.");

    const {
      repayAssets,
      withdrawAssets,
      collateralToSell,
      collateralReturned,
    } = computeExitAmounts(req.mode, position, req.targetLtv);

    if (collateralToSell === 0n)
      throw new Error("Computed swap amount is zero; nothing to unwind.");

    const quote = await fetchLiFiUnwindQuote({
      fromToken: market.collateralToken,
      toToken: market.loanToken,
      fromAmount: collateralToSell,
      fromAddress: this.config.morphoExitExecutor,
      chainId: this.config.chainId,
      slippage: SWAP_SLIPPAGE,
      lifiApiKey: this.config.lifiApiKey,
    });

    const minLoanOut = (quote.expectedOut * MIN_OUT_BPS) / 10000n;
    if (minLoanOut === 0n)
      throw new Error(
        "Unwind swap output too small to route; position likely dust.",
      );

    const flashAssets = req.mode === "deleverage" ? repayAssets : position.debt;
    if (quote.expectedOut < flashAssets)
      throw new Error("Unwind swap output does not cover the debt to repay.");

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const exitTx = this.encodeExitTx({
      market,
      mode: req.mode,
      repayAssets,
      withdrawAssets,
      collateralToSell,
      minLoanOut,
      dex: quote.dex,
      swapCalldata: quote.calldata,
      deadline,
    });

    const setupTxs = await this.authorizationTxs(walletAddress);
    const transactions = [...setupTxs, exitTx];

    const simulation = await this.simulator.simulate(
      transactions,
      walletAddress,
    );

    const settlement: ExitSettlement = {
      mode: req.mode,
      debtRepaid: flashAssets,
      collateralSold: collateralToSell,
      collateralReturned,
      expectedReceive:
        req.mode === "full_to_collateral"
          ? 0n
          : quote.expectedOut - flashAssets,
      receiveToken:
        req.mode === "full_to_collateral"
          ? market.collateralToken
          : market.loanToken,
    };

    return {
      description: this.describe(req.mode, position),
      transactions,
      simulation,
      position,
      settlement,
    };
  }

  // Per-mode amount math. For FULL modes debt/collateral come from the live position;
  // the contract re-reads both on-chain, so these are exact, not estimates.
  private encodeExitTx(p: {
    market: MorphoMarketParams;
    mode: ExitMode;
    repayAssets: bigint;
    withdrawAssets: bigint;
    collateralToSell: bigint;
    minLoanOut: bigint;
    dex: Address;
    swapCalldata: Address;
    deadline: bigint;
  }): EvmTransaction {
    const data = encodeFunctionData({
      abi: morphoExitExecutorAbi,
      functionName: "exitPosition",
      args: [
        {
          market: {
            loanToken: p.market.loanToken,
            collateralToken: p.market.collateralToken,
            oracle: p.market.oracle,
            irm: p.market.irm,
            lltv: p.market.lltv,
          },
          mode: EXIT_MODE_ENUM[p.mode],
          repayAssets: p.repayAssets,
          withdrawAssets: p.withdrawAssets,
          swapCollateralIn: p.collateralToSell,
          minLoanOut: p.minLoanOut,
          dex: p.dex,
          swapCalldata: p.swapCalldata,
          deadline: p.deadline,
        },
      ],
    });

    return {
      to: this.config.morphoExitExecutor,
      data,
      value: 0n,
      chainId: this.config.chainId,
    };
  }

  // Prepend Morpho setAuthorization for the exit executor when not already authorized.
  private async authorizationTxs(
    walletAddress: Address,
  ): Promise<EvmTransaction[]> {
    const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
    const authorized = await client.readContract({
      address: this.config.morphoBlue,
      abi: morphoBlueAbi,
      functionName: "isAuthorized",
      args: [walletAddress, this.config.morphoExitExecutor],
    });
    if (authorized) return [];

    const data = encodeFunctionData({
      abi: morphoBlueAbi,
      functionName: "setAuthorization",
      args: [this.config.morphoExitExecutor, true],
    });
    return [
      {
        to: this.config.morphoBlue,
        data,
        value: 0n,
        chainId: this.config.chainId,
      },
    ];
  }

  private async resolveMarket(
    marketRef: string,
  ): Promise<{ market: MorphoMarketParams }> {
    // bytes32 uniqueKey resolves directly.
    if (/^0x[a-fA-F0-9]{64}$/.test(marketRef)) {
      const market = await this.morphoService.fetchMarketByUniqueKey(marketRef);
      if (!market) throw new Error(`Morpho market "${marketRef}" not found.`);
      return { market };
    }

    // Human label "COLLATERAL-LOAN" (e.g. cbBTC-USDC or cbBTC/USDC).
    const parts = marketRef.split(/[-/]/).map((s) => s.trim());
    if (parts.length !== 2)
      throw new Error(
        `Invalid market "${marketRef}". Use a bytes32 id or a COLLATERAL-LOAN pair (e.g. cbBTC-USDC).`,
      );

    const collateralToken = tokenAddress(this.config.chainId, parts[0]);
    const loanToken = tokenAddress(this.config.chainId, parts[1]);
    if (!collateralToken || !loanToken)
      throw new Error(
        `Unknown token symbol in market "${marketRef}". Supported pairs use known Base tokens.`,
      );

    const market = await this.morphoService.fetchMarketByPair(
      collateralToken,
      loanToken,
    );
    if (!market)
      throw new Error(
        `No Morpho market found for ${parts[0]}/${parts[1]} on Base.`,
      );
    return { market };
  }

  private describe(mode: ExitMode, position: PositionView): string {
    const pct = (position.ltv * 100).toFixed(0);
    if (mode === "full_to_loan")
      return `Close position (${pct}% LTV) → receive USDC`;
    if (mode === "full_to_collateral")
      return `Repay debt (${pct}% LTV) → keep collateral`;
    return `Deleverage position from ${pct}% LTV`;
  }
}
