import { type Address, encodeAbiParameters } from "viem";
import type { EvmChainConfig, ProtocolEntry } from "../../types";
import { PendleMarketService } from "./pendle.service.js";
import { SWAP_SLIPPAGE, MIN_OUT_BPS } from "@domains/yield/types/market.js";
import { DEPOSIT_DATA_ABI } from "../../config/base_abi.js";
import { norm } from "../../helper/utils.js";
const DEADLINE_SECONDS = 600;

// The Pendle fixed-yield vault adapter (for USDC deposits and redemptions).
export class PendleVaultService {
  private readonly entry?: ProtocolEntry;
  private readonly usdc: Address;
  private readonly adapter: Address;
  private readonly pendle: PendleMarketService;

  constructor(config: EvmChainConfig, pendle?: PendleMarketService) {
    this.entry = config.protocols.find(
      (p) => p.pendleVaultMarkets && p.defaultPendleMarket,
    );
    this.usdc = config.usdc;
    this.adapter = this.entry?.address ?? ("0x" as Address);
    this.pendle = pendle ?? new PendleMarketService(config.chainId);
  }

  // Whether the Pendle fixed-yield vault is registered.
  get enabled(): boolean {
    return this.entry !== undefined;
  }

  // Resolves a market label/address to a whitelisted market address (or the default).
  resolveMarket(ref?: string): Address {
    if (!this.entry) throw new Error("Pendle vault is not configured.");
    const markets = this.entry.pendleVaultMarkets!;
    if (!ref) return this.entry.defaultPendleMarket!;

    if (/^0x[a-fA-F0-9]{40}$/.test(ref)) {
      const byAddr = markets.find(
        (m) => m.market.toLowerCase() === ref.toLowerCase(),
      );
      if (!byAddr)
        throw new Error(
          `Pendle market ${ref} is not whitelisted for the fixed-yield vault.`,
        );
      return byAddr.market;
    }

    const n = norm(ref);
    const matches = markets.filter((m) => n.includes(norm(m.label)));
    if (matches.length === 1) return matches[0].market;
    if (matches.length === 0) {
      throw new Error(
        `Pendle market "${ref}" is not whitelisted. Available: ${markets.map((m) => m.label).join(", ")}.`,
      );
    }
    throw new Error(
      `Pendle market "${ref}" is ambiguous. Be specific: ${markets.map((m) => m.label).join(", ")}.`,
    );
  }

  // Builds deposit `data` (buy PT) for an EXACT USDC amount. Only safe when the
  // amount is known at build time (plain deposit) — the guess bounds are amount-specific.
  async buildDepositData(
    usdcAmount: bigint,
    marketRef?: string,
  ): Promise<{
    data: Address;
    pt: Address;
    market: Address;
    expectedPtOut: bigint;
  }> {
    const market = this.resolveMarket(marketRef);
    const info = await this.pendle.resolveMarket(market);
    if (!info) throw new Error(`Could not resolve Pendle market ${market}.`);
    if (info.expired)
      throw new Error(
        `Pendle market ${info.name} has matured; deposits are closed.`,
      );

    const { minPtOut, guessPtOut, expectedOut } =
      await this.pendle.fetchPtDepositParams({
        receiver: this.adapter,
        tokenIn: this.usdc,
        amountIn: usdcAmount,
        ptToken: info.ptAddress,
        slippage: SWAP_SLIPPAGE,
      });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);
    const data = encodeAbiParameters(DEPOSIT_DATA_ABI, [
      market,
      minPtOut,
      [
        guessPtOut.guessMin,
        guessPtOut.guessMax,
        guessPtOut.guessOffchain,
        guessPtOut.maxIteration,
        guessPtOut.eps,
      ],
      deadline,
    ]);
    return { data, pt: info.ptAddress, market, expectedPtOut: expectedOut };
  }

  // Builds an EXECUTABLE standalone redeem: sell/redeem `ptShares` PT back to USDC
  // via a direct Pendle RouterV4 call with `receiver` as the user. This is the only
  // path that exits markets whose SY does not unwrap 1:1 to USDC (the vault adapter's
  // aggregator-off redeem cannot). Returns the router tx plus the min-out floor.
  async buildDirectRedeem(
    ptShares: bigint,
    receiver: Address,
    marketRef?: string,
  ): Promise<{
    to: Address;
    data: Address;
    value: bigint;
    pt: Address;
    minTokenOut: bigint;
  }> {
    const market = this.resolveMarket(marketRef);
    const info = await this.pendle.resolveMarket(market);
    if (!info) throw new Error(`Could not resolve Pendle market ${market}.`);

    const { to, data, value, expectedOut } = await this.pendle.fetchRedeemTx({
      receiver,
      ptToken: info.ptAddress,
      amountIn: ptShares,
      tokenOut: this.usdc,
      slippage: SWAP_SLIPPAGE,
    });
    const minTokenOut = (expectedOut * MIN_OUT_BPS) / 10000n;
    if (minTokenOut === 0n)
      throw new Error(
        "Pendle redeem quote returned zero; try a larger amount.",
      );
    return { to, data, value, pt: info.ptAddress, minTokenOut };
  }

  // The PT token whose balanceOf represents the user's position for a market.
  async ptToken(marketRef?: string): Promise<Address> {
    const market = this.resolveMarket(marketRef);
    const info = await this.pendle.resolveMarket(market);
    if (!info) throw new Error(`Could not resolve Pendle market ${market}.`);
    return info.ptAddress;
  }

  // Market implied (fixed) APY for the deposit preview; null when unavailable.
  async impliedApy(marketRef?: string): Promise<number | null> {
    const market = this.resolveMarket(marketRef);
    return this.pendle.fetchImpliedApy(market);
  }
}
