import { createPublicClient, http, encodeFunctionData, type Address } from "viem";
import { monad } from "viem/chains";
import type { EvmTransaction, BuildResult, EvmChainConfig } from "../../types";
import { MorphoMarketService, computeMarketId } from "./morpho.service.js";
import {
  morphoBlueAbi,
  morphoLeverageExecutorAbi,
  erc20Abi,
} from "../../config/abi";
import {
  fetchOraclePrice,
  ORACLE_PRICE_SCALE,
  WAD,
} from "../../execution/pricing.js";
import { aggregateStrategyApy } from "../../execution/apy.js";
import { fetchLiFiUnwindQuote } from "../lifi/swap-resolver.js";
import { readFeeBps, netAfterFee } from "../../helper/fee.js";
import {
  MorphoMarketParams,
  SWAP_SLIPPAGE,
  MIN_OUT_BPS,
} from "@domains/yield/types/market.js";
import type { LeverageIntentType } from "@domains/yield/types/intent.js";
import {
  ApyResolverPort,
  StrategyApy,
  StrategyLeg,
  StrategyLegRates,
} from "@core/services/apy/types";

const BPS = 10000n;

export class LeverageService {
  private readonly config: EvmChainConfig;
  private readonly morphoService: MorphoMarketService;
  private readonly apyResolver?: ApyResolverPort;
  constructor(config: EvmChainConfig, apyResolver?: ApyResolverPort) {
    this.config = config;
    this.morphoService = new MorphoMarketService(config.chainId);
    this.apyResolver = apyResolver;
  }
  /**
   * Builds a one-signature flash-loan leverage entry. For a multiplier L on equity E:
   *   flashAssets = (L - 1)·E,  swapIn = L·E,  final debt = flashAssets,  target LTV = 1 - 1/L.
   * The executor supplies the full swapped collateral before borrowing, so the LTV never
   * spikes mid-construction; Morpho's health check is the on-chain backstop.
   */
  async buildLeverage(
    intent: LeverageIntentType,
    walletAddress: Address,
  ): Promise<BuildResult> {
    const inputToken = intent.inputToken as Address;
    const collateralToken = intent.collateralToken as Address;
    if (inputToken.toLowerCase() === collateralToken.toLowerCase())
      throw new Error("Leverage input token and collateral token must differ.");
    const multiplierBps = BigInt(Math.round(intent.multiplier * 10000));
    if (multiplierBps <= BPS)
      throw new Error("Leverage multiplier must be greater than 1x.");
    const inputAmount = BigInt(intent.inputAmount);
    if (inputAmount === 0n) throw new Error("Leverage input amount is zero.");
    const targetLtv = 1 - 1 / intent.multiplier;
    const market = await this.resolveMarket(
      intent,
      collateralToken,
      inputToken,
      targetLtv,
    );
    // The executor pulls the loan token as equity, so the input must be the loan token.
    if (market.loanToken.toLowerCase() !== inputToken.toLowerCase())
      throw new Error(
        "Input token must equal the market loan token for leverage.",
      );
    // The executor skims its input fee off the equity before the flash loan, so the
    // real equity entering the position is the NET input. Size the leverage (flash
    // amount and entry swap) off the net so the baked swap `fromAmount` matches the
    // executor's `netInput + flashAssets` exactly; the gross `inputAmount` is still
    // pulled from the user (and approved) since the executor skims internally.
    const feeBps = await readFeeBps(
      this.config.rpcUrl,
      this.config.morphoLeverageExecutor,
    );
    const netInput = netAfterFee(inputAmount, feeBps);
    if (netInput === 0n)
      throw new Error("Leverage input amount is fully consumed by the fee.");

    // Guard: reject early if the wallet doesn't hold enough of the input token.
    const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
    const userBalance = (await client.readContract({
      address: inputToken,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    }).catch(() => 0n)) as bigint;
    if (userBalance > 0n && inputAmount > userBalance) {
      const decimals = inputToken.toLowerCase() === this.config.usdc?.toLowerCase() ? 6 : 18;
      const humanInput = (Number(inputAmount) / 10 ** decimals).toFixed(decimals === 6 ? 6 : 4);
      const humanBal = (Number(userBalance) / 10 ** decimals).toFixed(decimals === 6 ? 6 : 4);
      throw new Error(
        `Leverage requires ${humanInput} of the input token but the wallet only holds ${humanBal}. ` +
        `Check that the amount uses the correct decimals (USDC = 6, WETH/cbETH = 18).`,
      );
    }
    const flashAssets = (netInput * (multiplierBps - BPS)) / BPS;
    if (flashAssets === 0n)
      throw new Error(
        "Computed flash amount is zero; increase the multiplier or amount.",
      );
    const swapIn = netInput + flashAssets;
    const quote = await fetchLiFiUnwindQuote({
      fromToken: market.loanToken,
      toToken: market.collateralToken,
      fromAmount: swapIn,
      fromAddress: this.config.morphoLeverageExecutor,
      chainId: this.config.chainId,
      slippage: SWAP_SLIPPAGE,
      lifiApiKey: this.config.lifiApiKey,
    });
    const minCollateralOut = (quote.expectedOut * MIN_OUT_BPS) / BPS;
    if (minCollateralOut === 0n)
      throw new Error("Entry swap output too small to route.");
    const price = await fetchOraclePrice(this.config.rpcUrl, market.oracle);
    this.assertHealthy(market, flashAssets, minCollateralOut, price);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const openTx = this.encodeOpenTx({
      market,
      inputAssets: inputAmount,
      flashAssets,
      minCollateralOut,
      dex: quote.dex,
      swapCalldata: quote.calldata,
      deadline,
    });
    const setupTxs = await this.setupTxs(
      walletAddress,
      market.loanToken,
      inputAmount,
    );
    // Value the expected (not worst-case) collateral for the APY preview.
    const collateralValue = Number(
      (quote.expectedOut * price) / ORACLE_PRICE_SCALE,
    );
    const apy = await this.computeApy(
      market,
      collateralValue,
      Number(flashAssets),
    );
    return {
      transactions: [...setupTxs, openTx],
      description: `Open ${intent.multiplier}x leverage: supply ~${swapIn} loan-token of collateral, borrow ${flashAssets} (target LTV ${(targetLtv * 100).toFixed(0)}%)`,
      apy,
    };
  }
  // Net APY on the user's equity for the freshly opened leg: leveraged collateral
  // yield minus borrow cost. Withheld (status "unavailable") unless both rates resolve.
  private async computeApy(
    market: MorphoMarketParams,
    collateralValue: number,
    debtValue: number,
  ): Promise<StrategyApy | undefined> {
    if (!this.apyResolver || collateralValue <= 0) return undefined;
    const borrow = await this.apyResolver.resolve({
      kind: "morpho",
      chainId: this.config.chainId,
      marketKey: computeMarketId(market),
      name: `${market.collateralToken}/${market.loanToken}`,
    });
    const collateral = await this.apyResolver.resolve({
      kind: "staking",
      chainId: this.config.chainId,
      token: market.collateralToken,
      name: `${market.collateralToken} staking`,
    });
    const leg: StrategyLeg & StrategyLegRates = {
      marketKey: `${market.collateralToken}-${market.loanToken}`,
      marketKeyHash: computeMarketId(market),
      collateralToken: market.collateralToken,
      collateralValue,
      debtValue,
      collateralApy: collateral.rates?.supplyApy ?? null,
      collateralStatus: collateral.status,
      borrowApy: borrow.rates?.borrowApy ?? null,
      borrowStatus: borrow.status,
      rewardsApy: borrow.rates?.rewardsApy ?? 0,
    };
    const agg = aggregateStrategyApy([leg], 0);
    const now = new Date().toISOString();
    return {
      status: agg.status,
      asOf: now,
      leverage: agg.leverage,
      collateralApy: {
        value: agg.collateralApy,
        status: agg.status,
        source: "staking",
        token: market.collateralToken,
        updatedAt: now,
      },
      borrowApy: {
        value: agg.borrowApy,
        status: agg.status,
        source: "morpho",
        market: leg.marketKey,
        updatedAt: now,
      },
      baseApy: agg.collateralApy,
      netApy: { value: agg.netApy, status: agg.status },
      steps: [
        {
          index: 0,
          action: "supplyCollateral",
          apy: agg.collateralApy,
          kind: "earn",
          status: agg.status,
        },
        {
          index: 1,
          action: "borrow",
          apy: agg.borrowApy,
          kind: "cost",
          status: agg.status,
        },
      ],
      collateralToken: market.collateralToken,
      borrowMarketKey: computeMarketId(market),
      snapshot: {
        legs: [
          {
            marketKey: leg.marketKey,
            marketKeyHash: leg.marketKeyHash,
            collateralToken: leg.collateralToken,
            collateralValue,
            debtValue,
          },
        ],
        idleCash: 0,
      },
    };
  }
  // Pre-flight health guard using the worst-case (min) collateral the entry swap may yield.
  // Morpho reverts an unhealthy borrow on-chain regardless; this fails fast with a clear reason.
  private assertHealthy(
    market: MorphoMarketParams,
    flashAssets: bigint,
    minCollateralOut: bigint,
    price: bigint,
  ): void {
    const collateralValue = (minCollateralOut * price) / ORACLE_PRICE_SCALE;
    if (collateralValue === 0n)
      throw new Error(
        "Collateral value at min output is zero; cannot open leverage.",
      );
    const worstLtvWad = (flashAssets * WAD) / collateralValue;
    if (worstLtvWad >= market.lltv) {
      const worst = (Number(worstLtvWad) / Number(WAD)) * 100;
      const max = (Number(market.lltv) / Number(WAD)) * 100;
      throw new Error(
        `Leverage too high for this market: worst-case LTV ${worst.toFixed(1)}% exceeds max ${max.toFixed(1)}%. Lower the multiplier.`,
      );
    }
  }
  private encodeOpenTx(p: {
    market: MorphoMarketParams;
    inputAssets: bigint;
    flashAssets: bigint;
    minCollateralOut: bigint;
    dex: Address;
    swapCalldata: Address;
    deadline: bigint;
  }): EvmTransaction {
    const data = encodeFunctionData({
      abi: morphoLeverageExecutorAbi,
      functionName: "openLeverage",
      args: [
        {
          market: {
            loanToken: p.market.loanToken,
            collateralToken: p.market.collateralToken,
            oracle: p.market.oracle,
            irm: p.market.irm,
            lltv: p.market.lltv,
          },
          inputAssets: p.inputAssets,
          flashAssets: p.flashAssets,
          minCollateralOut: p.minCollateralOut,
          dex: p.dex,
          swapCalldata: p.swapCalldata,
          deadline: p.deadline,
        },
      ],
    });
    return {
      to: this.config.morphoLeverageExecutor,
      data,
      value: 0n,
      chainId: this.config.chainId,
    };
  }
  // Approve the executor to pull the equity, and authorize it on Morpho when not already set.
  private async setupTxs(
    walletAddress: Address,
    loanToken: Address,
    inputAmount: bigint,
  ): Promise<EvmTransaction[]> {
    const txs: EvmTransaction[] = [
      {
        to: loanToken,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [this.config.morphoLeverageExecutor, inputAmount],
        }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];
    const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
    const authorized = await client.readContract({
      address: this.config.morphoBlue,
      abi: morphoBlueAbi,
      functionName: "isAuthorized",
      args: [walletAddress, this.config.morphoLeverageExecutor],
    });
    if (!authorized) {
      txs.push({
        to: this.config.morphoBlue,
        data: encodeFunctionData({
          abi: morphoBlueAbi,
          functionName: "setAuthorization",
          args: [this.config.morphoLeverageExecutor, true],
        }),
        value: 0n,
        chainId: this.config.chainId,
      });
    }
    return txs;
  }

  private async resolveMarket(
    intent: LeverageIntentType,
    collateralToken: Address,
    loanToken: Address,
    targetLtv: number,
  ): Promise<MorphoMarketParams> {
    // Explicit bytes32 market id resolves directly.
    if (intent.marketId && /^0x[a-fA-F0-9]{64}$/.test(intent.marketId)) {
      const market = await this.morphoService.fetchMarketByUniqueKey(
        intent.marketId,
      );
      if (!market)
        throw new Error(`Morpho market "${intent.marketId}" not found.`);
      return market;
    }
    const market = await this.morphoService.fetchMarketByPair(
      collateralToken,
      loanToken,
      targetLtv,
    );
    if (!market)
      throw new Error(
        `No Morpho market with enough headroom for ${intent.multiplier}x leverage on this pair.`,
      );
    return market;
  }
}
