import { createPublicClient, http, encodeFunctionData, type Address } from "viem";
import { monad } from "viem/chains";
import { CalldataBuilder } from "./contracts/vault-builder.js";
import { EvmSimulator } from "./simulator.js";
import { StrategyService } from "./execution/strategy.service.js";
import { LeverageService } from "./protocols/morpho/leverage.service.js";
import {
  fetchLiFiSwapData,
  fetchLiFiBridgeData,
} from "./protocols/lifi/swap-resolver.js";
import { fortVaultAbi, fortVaultFeeAbi, crossChainRouterAbi, erc20Abi } from "./config/abi.js";
import { readFeeBps, netAfterFee } from "./helper/fee.js";
import type {
  EvmChainConfig,
  EvmTransaction,
  EvmSimulationResult,
  BuildResult,
} from "./types.js";
import type { Intent } from "@domains/yield/types/intent.js";
import type { ApyResolverPort, StrategyApy } from "@core/services/apy/types.js";
import { PlannerRefusal } from "@shared/errors.js";
import { FortressLogger } from "@shared/logger.js";

export type KernelResult = {
  intent: Intent;
  description: string;
  transactions: EvmTransaction[];
  simulation: EvmSimulationResult;
  apy?: StrategyApy;
};

const DEST_USDC: Record<number, Address> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  10: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
};

export class EvmKernel {
  private readonly builder: CalldataBuilder;
  private readonly simulator: EvmSimulator;
  private readonly strategyService: StrategyService;
  private readonly leverageService: LeverageService;
  private readonly config: EvmChainConfig;
  private readonly _apyResolver?: ApyResolverPort;

  constructor(deps: {
    config: EvmChainConfig;
    tenderly: { accessKey: string; accountSlug: string; projectSlug: string };
    apyResolver?: ApyResolverPort;
  }) {
    this.config = deps.config;
    this._apyResolver = deps.apyResolver;
    this.builder = new CalldataBuilder(deps.config);
    this.simulator = new EvmSimulator(deps.tenderly);
    this.strategyService = new StrategyService(deps.config, deps.apyResolver);
    this.leverageService = new LeverageService(deps.config, deps.apyResolver);
  }

  get chainKey(): string {
    return this.config.chainKey;
  }

  get chainId(): number {
    return this.config.chainId;
  }

  get evmConfig(): EvmChainConfig {
    return this.config;
  }

  get apyResolver(): ApyResolverPort | undefined {
    return this._apyResolver;
  }

  // Main entrypoint for the planner (build + simulate)
  async execute(
    intent: Intent,
    walletAddress: Address,
    log: FortressLogger,
  ): Promise<KernelResult> {
    const resolved = await this.resolveZeroAmount(intent, walletAddress);

    const { transactions, description, apy } = await this.buildTransactions(
      resolved,
      walletAddress,
      log,
    );
    log.transactions(transactions);

    const simulation = await this.simulator.simulate(transactions, walletAddress);
    log.simulation(simulation);

    return { intent: resolved, description, transactions, simulation, apy };
  }

  // Exposed for the simulate route (no planner, just rebuild + simulate)
  async executeFromIntent(
    intent: Intent,
    walletAddress: Address,
    log: FortressLogger,
  ): Promise<KernelResult> {
    return this.execute(intent, walletAddress, log);
  }

  // Exposed for strategy preview (build only, no simulate)
  async preview(
    intent: Intent,
    walletAddress: Address,
    log: FortressLogger,
  ): Promise<{ description: string; apy?: StrategyApy }> {
    const { description, apy } = await this.buildTransactions(intent, walletAddress, log);
    return { description, apy };
  }

  private async resolveZeroAmount(
    intent: Intent,
    walletAddress: Address,
  ): Promise<Intent> {
    if (intent.action === "deposit" || intent.action === "swapAndDeposit") {
      if (intent.amount === "0" || intent.amount === "") {
        const token =
          intent.action === "swapAndDeposit"
            ? (intent.inputToken as Address)
            : this.config.usdc;
        const balance = await this.readTokenBalance(token, walletAddress);
        if (balance === 0n) {
          throw new PlannerRefusal("Your wallet has no balance of the input token to deposit.");
        }
        return { ...intent, amount: balance.toString() };
      }
    }
    if (intent.action === "strategy" || intent.action === "leverage") {
      if (intent.inputAmount === "0" || intent.inputAmount === "") {
        const token = intent.inputToken as Address;
        const balance = await this.readTokenBalance(token, walletAddress);
        if (balance === 0n) {
          throw new PlannerRefusal("Your wallet has no balance of the input token.");
        }
        return { ...intent, inputAmount: balance.toString() };
      }
    }
    return intent;
  }

  private async buildTransactions(
    intent: Intent,
    walletAddress: Address,
    log?: FortressLogger,
  ): Promise<BuildResult> {
    switch (intent.action) {
      case "swapAndDeposit":
        return this.resolveSwapAndDeposit(intent);
      case "bridge":
        return this.resolveBridge(intent, walletAddress);
      case "strategy":
        return this.strategyService.resolveStrategy(intent, walletAddress, log);
      case "leverage":
        return this.leverageService.buildLeverage(intent, walletAddress);
      default:
        return this.builder.build(intent, walletAddress);
    }
  }

  private async resolveSwapAndDeposit(
    intent: Extract<Intent, { action: "swapAndDeposit" }>,
  ): Promise<BuildResult> {
    const { swapData, expectedOut } = await fetchLiFiSwapData({
      fromToken: intent.inputToken as Address,
      toToken: this.config.usdc,
      fromAmount: BigInt(intent.amount),
      fromAddress: this.config.swapRouter,
      chainId: this.config.chainId,
      slippage: 0.005,
      config: this.config,
    });

    const minUsdcOut =
      BigInt(intent.minUsdcOut) > 0n
        ? BigInt(intent.minUsdcOut)
        : (expectedOut * 95n) / 100n;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    // Read on-chain deposit fee to adjust minSharesOut calculation.
    // The vault deducts the fee from the swapped USDC before depositing.
    let feeBps = 0n;
    try {
      const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
      const fee = (await client.readContract({
        address: this.config.vault,
        abi: fortVaultFeeAbi,
        functionName: "depositFeeBps",
      })) as number;
      feeBps = BigInt(fee);
    } catch {
      // Graceful degradation: if read fails, assume 0 fee (slightly tighter slippage).
    }

    const entries = await Promise.all(
      intent.allocations.map(async (a) => {
        const protocol = this.config.protocols.find(
          (p) => p.name.toLowerCase() === a.protocol.toLowerCase(),
        );
        if (!protocol) throw new Error(`Unknown protocol: ${a.protocol}`);
        // Compute the USDC each leg receives AFTER the deposit fee is deducted.
        const legUsdcGross = (minUsdcOut * BigInt(a.bps)) / 10000n;
        const legUsdcNet = feeBps > 0n
          ? legUsdcGross - (legUsdcGross * feeBps) / 10000n
          : legUsdcGross;
        return {
          protocolKey: protocol.key,
          bps: a.bps,
          minSharesOut: await this.builder.minSharesForProtocol(protocol, legUsdcNet),
          data: "0x" as Address,
        };
      }),
    );

    const transactions: EvmTransaction[] = [
      this.approval(intent.inputToken as Address, this.config.swapRouter, BigInt(intent.amount)),
      {
        to: this.config.swapRouter,
        data: encodeFunctionData({
          abi: fortVaultAbi,
          functionName: "swapAndDeposit",
          args: [
            intent.inputToken as Address,
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

    return { transactions, description: `Swap → USDC (min ${minUsdcOut}) and deposit across ${entries.length} protocol(s)` };
  }

  private async resolveBridge(
    intent: Extract<Intent, { action: "bridge" }>,
    walletAddress: Address,
  ): Promise<BuildResult> {
    const destUsdc = DEST_USDC[intent.destChainId];
    if (!destUsdc) {
      throw new Error(`Bridging to chain ${intent.destChainId} is not supported.`);
    }

    // Resolve "full balance" (amount=0 or amount="0") to the live on-chain balance.
    let amount = BigInt(intent.amount);
    if (amount === 0n) {
      amount = await this.readTokenBalance(this.config.usdc, walletAddress);
      if (amount === 0n) {
        throw new Error("No USDC balance to bridge.");
      }
    }

    // The router skims its input fee before approving USDC to LiFi, so only the
    // NET amount is available to bridge. Build the LiFi route for the net, but pass
    // the gross as the function arg (the router pulls gross from the user, then skims).
    const feeBps = await readFeeBps(this.config.rpcUrl, this.config.crossChainRouter);
    const netAmount = netAfterFee(amount, feeBps);

    // LiFi has no viable route below a bridge's per-route minimum (typically a few
    // dollars of USDC). Rather than surface a cryptic on-chain revert from an
    // unroutable dust amount, convert LiFi's routing failure into a clear message.
    let lifiData: Address;
    try {
      ({ lifiData } = await fetchLiFiBridgeData({
        fromToken: this.config.usdc,
        toToken: destUsdc,
        fromAmount: netAmount,
        fromAddress: this.config.crossChainRouter,
        toAddress: walletAddress,
        chainId: this.config.chainId,
        toChainId: intent.destChainId,
        slippage: 0.005,
        lifiApiKey: this.config.lifiApiKey,
      }));
    } catch (err: unknown) {
      const usdcAmount = (Number(netAmount) / 1e6).toFixed(2);
      throw new PlannerRefusal(
        `Couldn't find a bridge route for ${usdcAmount} USDC to chain ${intent.destChainId}. ` +
        `Bridges enforce a per-route minimum (usually a few dollars) — try a larger amount.`,
      );
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const transactions: EvmTransaction[] = [
      this.approval(this.config.usdc, this.config.crossChainRouter, amount),
      {
        to: this.config.crossChainRouter,
        data: encodeFunctionData({
          abi: crossChainRouterAbi,
          functionName: "depositCrossChain",
          args: [amount, BigInt(intent.destChainId), walletAddress, lifiData, deadline],
        }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];

    return { transactions, description: `Bridge ${netAmount.toString()} USDC (of ${amount.toString()} in) to chain ${intent.destChainId}` };
  }

  private approval(token: Address, spender: Address, amount: bigint): EvmTransaction {
    return {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
      value: 0n,
      chainId: this.config.chainId,
    };
  }

  private async readTokenBalance(token: Address, wallet: Address): Promise<bigint> {
    const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
    return (await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    })) as bigint;
  }
}
