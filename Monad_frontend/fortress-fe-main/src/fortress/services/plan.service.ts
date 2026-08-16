import { FortressPlanner } from "../helpers/planner.js";
import {
  CalldataBuilder,
  type UnsignedTransaction,
  type BuildResult,
} from "../helpers/builder.js";
import {
  FortressSimulator,
  type SimulationResult,
} from "../helpers/simulator.js";
import {
  fetchLiFiSwapData,
  fetchLiFiBridgeData,
} from "../helpers/swap-resolver.js";
import {
  fortVaultAbi,
  crossChainRouterAbi,
  erc20Abi,
} from "../utils/abi.js";

import { StrategyService } from "./strategy.service.js";
import { FortressLogger } from "../utils/logger.js";
import type { FortressConfig } from "../utils/config.js";
import type { Intent } from "../types/intent.js";
import { encodeFunctionData } from "viem";

export type PlanResult = {
  intent: Intent;
  description: string;
  transactions: UnsignedTransaction[];
  simulation: SimulationResult;
};

export class FortressService {
  private readonly planner: FortressPlanner;
  private readonly builder: CalldataBuilder;
  private readonly simulator: FortressSimulator;
  private readonly strategyService: StrategyService;
  private readonly config: FortressConfig;

  constructor(deps: {
    planner: FortressPlanner;
    builder: CalldataBuilder;
    simulator: FortressSimulator;
    config: FortressConfig;
  }) {
    this.planner = deps.planner;
    this.builder = deps.builder;
    this.simulator = deps.simulator;
    this.strategyService = new StrategyService(deps.config);
    this.config = deps.config;
  }

  // Main entry point to plan a user intent
  async plan(
    prompt: string,
    walletAddress: `0x${string}`,
    log: FortressLogger,
    contracts: string,
  ): Promise<PlanResult> {
    log.prompt(prompt);

    const intent = await this.planner.extractIntent(prompt, contracts);
    log.intent(intent);

    if (intent.action === "refuse") {
      throw new PlannerRefusal(intent.reason);
    }

    log.action(intent.action);

    const { transactions, description } = await this.buildTransactions(
      intent,
      walletAddress,
    );
    log.transactions(transactions);

    const simulation = await this.simulator.simulate(
      transactions,
      walletAddress,
    );
    log.simulation(simulation);

    return { intent, description, transactions, simulation };
  }

  // Build transactions based on the extracted intent
  private async buildTransactions(
    intent: Intent,
    walletAddress: `0x${string}`,
  ): Promise<BuildResult> {
    if (intent.action === "swapAndDeposit") {
      return this.resolveSwapAndDeposit(intent);
    }
    if (intent.action === "bridge") {
      return this.resolveBridge(intent, walletAddress);
    }
    if (intent.action === "strategy") {
      return this.strategyService.resolveStrategy(intent, walletAddress);
    }
    return this.builder.build(intent);
  }

  // Resolve a swap and deposit intent into a list of transactions.
  private async resolveSwapAndDeposit(
    intent: Extract<Intent, { action: "swapAndDeposit" }>,
  ): Promise<BuildResult> {
    const { swapData, expectedOut } = await fetchLiFiSwapData({
      fromToken: intent.inputToken as `0x${string}`,
      toToken: this.config.usdc,
      fromAmount: BigInt(intent.amount),
      fromAddress: this.config.vault,
      chainId: this.config.chainId,
      slippage: 0.005,
      config: this.config,
    });

    const minUsdcOut =
      BigInt(intent.minUsdcOut) > 0n
        ? BigInt(intent.minUsdcOut)
        : (expectedOut * 95n) / 100n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    const entries = intent.allocations.map((a) => {
      const protocol = this.config.protocols.find(
        (p) => p.name.toLowerCase() === a.protocol.toLowerCase(),
      );
      if (!protocol) throw new Error(`Unknown protocol: ${a.protocol}`);
      return {
        protocolKey: protocol.key,
        bps: a.bps,
        data: "0x" as `0x${string}`,
      };
    });

    const transactions: UnsignedTransaction[] = [
      this.approval(
        intent.inputToken as `0x${string}`,
        this.config.vault,
        BigInt(intent.amount),
      ),
      {
        to: this.config.vault,
        data: encodeFunctionData({
          abi: fortVaultAbi,
          functionName: "swapAndDeposit",
          args: [
            intent.inputToken as `0x${string}`,
            BigInt(intent.amount),
            minUsdcOut,
            deadline,
            swapData,
            entries,
          ],
        }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];

    return {
      transactions,
      description: `Swap → USDC (min ${minUsdcOut}) and deposit across ${entries.length} protocol(s)`,
    };
  }

  // Resolve a bridge intent into a list of transactions.
  private async resolveBridge(
    intent: Extract<Intent, { action: "bridge" }>,
    walletAddress: `0x${string}`,
  ): Promise<BuildResult> {
    const { lifiData } = await fetchLiFiBridgeData({
      fromToken: this.config.usdc,
      toToken: this.config.usdc,
      fromAmount: BigInt(intent.amount),
      fromAddress: this.config.crossChainRouter,
      toAddress: walletAddress,
      fromChainId: this.config.chainId,
      toChainId: intent.destChainId,
      slippage: 0.005,
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const transactions: UnsignedTransaction[] = [
      this.approval(
        this.config.usdc,
        this.config.crossChainRouter,
        BigInt(intent.amount),
      ),
      {
        to: this.config.crossChainRouter,
        data: encodeFunctionData({
          abi: crossChainRouterAbi,
          functionName: "depositCrossChain",
          args: [
            BigInt(intent.amount),
            BigInt(intent.destChainId),
            lifiData,
            deadline,
          ],
        }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];

    return {
      transactions,
      description: `Bridge ${intent.amount} USDC to chain ${intent.destChainId}`,
    };
  }

  // Build an ERC20 approval transaction for the given token, spender, and amount.
  private approval(
    token: `0x${string}`,
    spender: `0x${string}`,
    amount: bigint,
  ): UnsignedTransaction {
    return {
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      }),
      value: 0n,
      chainId: this.config.chainId,
    };
  }
}

export class PlannerRefusal extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "PlannerRefusal";
  }
}
