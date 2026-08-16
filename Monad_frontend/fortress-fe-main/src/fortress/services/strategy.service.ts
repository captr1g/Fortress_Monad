import { createPublicClient, http } from "viem";
import {
    StrategyBuilder,
    type StrategyBuildContext,
    type MorphoMarketParams,
} from "../helpers/strategy-builder.js";
import { expandLeverageLoop } from "../helpers/strategy-resolver.js";
import type { FortressConfig } from "../utils/config.js";
import type { UnsignedTransaction, BuildResult } from "../helpers/builder.js";
import { erc20Abi, morphoBlueAbi } from "../utils/abi.js";
import type { Intent } from "../types/intent.js";
import type { StrategyIntent } from "../types/strategy.js";
import { MorphoMarketService } from "./morpho.service.js";

export class StrategyService {
    private readonly strategyBuilder: StrategyBuilder;
    private readonly config: FortressConfig;
    private readonly morphoService: MorphoMarketService;

    constructor(config: FortressConfig) {
        this.strategyBuilder = new StrategyBuilder();
        this.config = config;
        this.morphoService = new MorphoMarketService(config.chainId);
    }

    // Resolve a strategy intent into a flat list of transactions, including any setup transactions (e.g., Morpho adapter authorization) and expanded leverage loops if applicable.
    async resolveStrategy(
        intent: Extract<Intent, { action: "strategy" }>,
        walletAddress: `0x${string}`,
    ): Promise<BuildResult> {
        // Resolve the amount if user just start with bro swap 100%
        const inputAmount = await this.resolveInputAmount(
            intent.inputToken as `0x${string}`,
            intent.inputAmount,
            walletAddress,
        );

        // Collect unique market identifiers from the strategy steps
        const marketIds = new Set<string>();
        for (const step of intent.steps) {
            if (step.protocolData?.marketId) {
                marketIds.add(step.protocolData.marketId);
            }
        }

        // Check if there are any Morpho-specific steps in the strategy but as we add more protocol this logic need to be changed
        const hasMorphoSteps = intent.steps.some(
            (s) =>
                s.action === "supplyCollateral" ||
                s.action === "borrow" ||
                s.action === "repay" ||
                s.action === "withdrawCollateral",
        );

        const morphoMarkets = new Map<string, MorphoMarketParams>();

        // If no market IDs are provided but there are Morpho steps, attempt to infer the market from the strategy steps and fetch its parameters from the Morpho API. Otherwise, resolve each referenced market ID to its parameters.
        if (marketIds.size === 0 && hasMorphoSteps) {
            // Infer the collateral/loan pair from the strategy steps
            const pair = this.morphoService.inferMarketTokens(intent);
            if (pair) {
                const resolved = await this.morphoService.fetchMarketByPair(
                    pair.collateralToken,
                    pair.loanToken,
                    intent.targetLtv,
                );
                if (resolved) {
                    const syntheticKey = `${pair.collateralToken}-${pair.loanToken}`;
                    marketIds.add(syntheticKey);
                    morphoMarkets.set(syntheticKey, resolved);
                    // Inject into all Morpho steps so the builder finds it
                    for (const step of intent.steps) {
                        if (
                            step.action === "supplyCollateral" ||
                            step.action === "borrow" ||
                            step.action === "repay" ||
                            step.action === "withdrawCollateral"
                        ) {
                            if (!step.protocolData) (step as any).protocolData = {};
                            (step as any).protocolData.marketId = syntheticKey;
                        }
                    }
                }
            }
        } else {
            // Resolve each referenced market (bytes32 or name)
            for (const marketId of marketIds) {
                const params = await this.morphoService.resolveMorphoMarket(
                    marketId,
                    intent,
                    intent.targetLtv,
                );
                if (params) morphoMarkets.set(marketId, params);
            }
        }

        // Determine the collateral and borrow tokens from the first market
        const firstMarketId = [...marketIds][0];
        const firstMarket = firstMarketId
            ? morphoMarkets.get(firstMarketId)
            : undefined;

        if (firstMarketId && !firstMarket) {
            throw new Error(
                `Could not resolve Morpho market "${firstMarketId}". Provide a valid market ID (bytes32) or a supported collateral/loan pair.`,
            );
        }

        // If the user specified loops and a target LTV, expand the strategy steps into a leverage loop using the first market's collateral and loan tokens. Otherwise, use the original steps.
        let resolvedSteps = intent.steps;

        if (
            intent.loops &&
            intent.loops > 0 &&
            intent.targetLtv &&
            firstMarket &&
            firstMarketId
        ) {
            resolvedSteps = expandLeverageLoop({
                inputToken: intent.inputToken as `0x${string}`,
                collateralToken: firstMarket.collateralToken,
                borrowToken: firstMarket.loanToken,
                inputAmount,
                targetLtv: intent.targetLtv,
                loops: intent.loops,
                marketId: firstMarketId,
                swapSlippage: 0.005,
            });
        }

        // Swap calldata fetcher using LiFi
        const fetchSwapCalldata: StrategyBuildContext["fetchSwapCalldata"] = async (
            params,
        ) => {
            const url = new URL("https://li.quest/v1/quote");
            url.searchParams.set("fromChain", String(this.config.chainId));
            url.searchParams.set("toChain", String(this.config.chainId));
            url.searchParams.set("fromToken", params.fromToken);
            url.searchParams.set("toToken", params.toToken);
            url.searchParams.set("fromAmount", String(params.fromAmount));
            url.searchParams.set("fromAddress", this.config.swapAdapter);
            url.searchParams.set("slippage", String(params.slippage));

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10_000);

            try {
                const res = await fetch(url.toString(), { signal: controller.signal });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    throw new Error(`LiFi swap quote failed (${res.status}): ${body}`);
                }

                const json = (await res.json()) as {
                    estimate: { toAmount: string };
                    transactionRequest: { to: string; data: string };
                };

                return {
                    dex: json.transactionRequest.to as `0x${string}`,
                    calldata: json.transactionRequest.data as `0x${string}`,
                    expectedOut: BigInt(json.estimate.toAmount),
                };
            } finally {
                clearTimeout(timeout);
            }
        };

        const ctx: StrategyBuildContext = {
            walletAddress,
            config: this.config,
            morphoMarkets,
            fetchSwapCalldata,
        };

        const strategyIntent: StrategyIntent = {
            action: "strategy",
            inputToken: intent.inputToken,
            inputAmount: inputAmount.toString(),
            steps: resolvedSteps,
        };

        const result = await this.strategyBuilder.build(strategyIntent, ctx);

        // Filter out any Morpho `setAuthorization` setup tx if the adapter is already authorized on-chain for the user. This avoids unnecessary setup transactions.
        const setupTxs = await this.filterAuthorizationTxs(
            result.setupTxs,
            walletAddress,
        );

        const totalSteps = resolvedSteps.length;
        const loopCount = intent.loops ?? 0;
        const allTransactions = [...setupTxs, ...result.transactions];
        const description = `Execute ${totalSteps}-step leverage strategy (${loopCount} loops at ${((intent.targetLtv ?? 0) * 100).toFixed(0)}% LTV)`;

        return { transactions: allTransactions, description };
    }

    /**
     * Removes the Morpho `setAuthorization` setup tx when the adapter is already
     * authorized on-chain for the user. Falls back to keeping the tx if the
     * on-chain read fails, so a flaky RPC never blocks a valid strategy.
     */
    async filterAuthorizationTxs(
        setupTxs: UnsignedTransaction[],
        walletAddress: `0x${string}`,
    ): Promise<UnsignedTransaction[]> {
        if (setupTxs.length === 0) return setupTxs;

        let authorized = false;
        try {
            const client = createPublicClient({
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
        token: `0x${string}`,
        rawAmount: string,
        walletAddress: `0x${string}`,
    ): Promise<bigint> {
        const declared = BigInt(rawAmount);
        if (declared > 0n) return declared;

        const client = createPublicClient({ transport: http(this.config.rpcUrl) });
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
}
