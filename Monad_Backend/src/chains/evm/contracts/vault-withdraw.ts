import { createPublicClient, http, type PublicClient, type Address } from "viem";

import { base } from "viem/chains";

import {
  resolveProtocolEntry,
  type EvmTransaction,
  type EvmSimulationResult,
  type EvmChainConfig,
  type ProtocolEntry,
} from "../types.js";
import { CalldataBuilder } from "./vault-builder.js";
import { EvmSimulator } from "../simulator.js";
import { erc20Abi, erc4626Abi } from "../config/base_abi.js";
import { AerodromeVaultService } from "../protocols/aerodrome/aerodrome-vault.service.js";

export type AmountType = "shares" | "usdc" | "percent" | "all";

export type WithdrawResult = {
  description: string;
  protocol: string;
  shares: string;
  minUsdcOut: string;
  transactions: EvmTransaction[];
  simulation: EvmSimulationResult;
};

export class WithdrawService {
  private readonly builder: CalldataBuilder;
  private readonly simulator: EvmSimulator;
  private readonly config: EvmChainConfig;
  private readonly aerodromeVault: AerodromeVaultService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;

  constructor(
    config: EvmChainConfig,
    builder: CalldataBuilder,
    simulator: EvmSimulator,
  ) {
    this.config = config;
    this.builder = builder;
    this.simulator = simulator;
    this.client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
    this.aerodromeVault = new AerodromeVaultService(config);
  }

  /**
   * Build a withdraw transaction.
   *
   * - tokenOrName: ERC-4626 share token address OR protocol name ("Morpho", "Aave")
   * - amount:      value to withdraw (interpretation depends on amountType)
   * - amountType:
   *     "usdc"    → amount is raw USDC units (6 decimals).
   *     "shares"  → amount is raw share units. Used directly.
   *     "percent" → amount is 1–100. Computed as percentage of user's share balance.
   *     "all"     → ignores amount, withdraws full balance.
   */
  async buildWithdraw(
    walletAddress: Address,
    tokenOrName: string,
    amount: string,
    amountType: AmountType,
  ): Promise<WithdrawResult> {
    const protocol = this.resolveProtocol(tokenOrName);

    // For Aerodrome, the user may pass a specific gauge address (e.g. USDC-WETH
    // gauge) which differs from the protocol's default positionToken. Use the
    // actual address the user provided for balance reads.
    const balanceToken = this.resolveBalanceToken(protocol, tokenOrName);

    const shares = await this.resolveShares(
      protocol,
      amount,
      amountType,
      walletAddress,
      balanceToken,
    );

    // For Aerodrome, identify which pool the user is withdrawing from
    // so the builder uses the correct gauge in buildDirectWithdrawTxs, and
    // so the preview below can quote against the right pool's reserves.
    const aerodromePool = this.resolveAerodromePoolLabel(protocol, tokenOrName);

    const minUsdcOut = await this.minUsdcOut(protocol, shares, aerodromePool);

    const { transactions, description } = await this.builder.build(
      {
        action: "withdraw" as const,
        entries: [{ protocol: protocol.name, shares: shares.toString(), aerodromePool }],
      },
      walletAddress,
    );

    const simulation = await this.simulator.simulate(
      transactions,
      walletAddress,
    );

    return {
      description,
      protocol: protocol.name,
      shares: shares.toString(),
      minUsdcOut: minUsdcOut.toString(),
      transactions,
      simulation,
    };
  }

  /** Resolves the token to read balanceOf from, respecting Aerodrome multi-gauge. */
  private resolveBalanceToken(protocol: ProtocolEntry, tokenOrName: string): Address {
    if (protocol.aerodromePools && tokenOrName.startsWith("0x") && tokenOrName.length === 42) {
      const normalized = tokenOrName.toLowerCase();
      const matchedPool = protocol.aerodromePools.find(
        (p) => p.gauge.toLowerCase() === normalized,
      );
      if (matchedPool) return matchedPool.gauge;
    }
    return this.vaultTokenAddress(protocol);
  }

  /** Resolves the Aerodrome pool label from a gauge address (for the builder). */
  private resolveAerodromePoolLabel(protocol: ProtocolEntry, tokenOrName: string): string | undefined {
    if (!protocol.aerodromePools) return undefined;
    if (tokenOrName.startsWith("0x") && tokenOrName.length === 42) {
      const normalized = tokenOrName.toLowerCase();
      const match = protocol.aerodromePools.find((p) => p.gauge.toLowerCase() === normalized);
      if (match) return match.label;
    }
    return protocol.defaultAerodromePool;
  }

  private resolveProtocol(tokenOrName: string): ProtocolEntry {
    if (tokenOrName.startsWith("0x") && tokenOrName.length === 42) {
      const normalized = tokenOrName.toLowerCase();
      const found = this.config.protocols.find(
        (p) =>
          p.address.toLowerCase() === normalized ||
          (p.positionToken && p.positionToken.toLowerCase() === normalized) ||
          (p.aerodromePools && p.aerodromePools.some((pool) => pool.gauge.toLowerCase() === normalized)),
      );
      if (found) return found;
    }

    const found = resolveProtocolEntry(this.config.protocols, tokenOrName);
    if (found) return found;

    const known = this.config.protocols
      .map((p) => `${p.name}: ${p.address}`)
      .join(", ");
    throw new Error(`Unknown protocol "${tokenOrName}". Available: ${known}`);
  }

  /// Returns the token address to read balanceOf from for a protocol's position.
  /// - ERC-4626 protocols: protocol.address (the vault itself)
  /// - Compound V3: positionToken (Comet — balanceOf returns USDC-equivalent 1:1)
  /// - Yo-style adapters: positionToken (an ERC-4626 vault the user holds directly)
  private vaultTokenAddress(protocol: ProtocolEntry): Address {
    if (protocol.positionToken) return protocol.positionToken;
    return protocol.address;
  }

  /// Whether this protocol's position token supports ERC-4626 view functions
  /// (previewRedeem, convertToShares). Compound V3's Comet does NOT — its
  /// balanceOf already returns USDC amounts 1:1, so shares = USDC directly.
  private isPositionErc4626(protocol: ProtocolEntry): boolean {
    if (protocol.isERC4626) return true;
    if (protocol.name === "CompoundV3") return false;
    // Aerodrome gauge is not ERC-4626 — it's a staking gauge with balanceOf only.
    if (protocol.aerodromePools) return false;
    if (protocol.positionToken) return true;
    return false;
  }

  private async resolveShares(
    protocol: ProtocolEntry,
    amount: string,
    amountType: AmountType,
    walletAddress: Address,
    balanceToken?: Address,
  ): Promise<bigint> {
    if (amountType === "all") {
      return this.fullBalance(protocol, walletAddress, balanceToken);
    }

    if (amountType === "shares") {
      const requested = BigInt(amount);
      if (requested === 0n) return this.fullBalance(protocol, walletAddress, balanceToken);
      return requested;
    }

    if (amountType === "percent") {
      const pct = Number(amount);
      if (pct <= 0 || pct > 100) {
        throw new Error(`percent must be 1–100, got ${amount}`);
      }
      const balance = await this.fullBalance(protocol, walletAddress, balanceToken);
      return (balance * BigInt(Math.round(pct * 100))) / 10000n;
    }

    // USDC amount → convert to shares via on-chain convertToShares
    if (amountType === "usdc") {
      const usdcAmount = BigInt(amount);
      if (usdcAmount === 0n) return this.fullBalance(protocol, walletAddress, balanceToken);

      // Compound V3: balance IS USDC 1:1 — no conversion needed, shares = USDC.
      if (!this.isPositionErc4626(protocol)) {
        const balance = await this.fullBalance(protocol, walletAddress, balanceToken).catch(() => 0n);
        return usdcAmount > balance ? balance : usdcAmount;
      }

      const vaultAddr = this.vaultTokenAddress(protocol);
      const shares = (await this.client.readContract({
        address: vaultAddr,
        abi: erc4626Abi,
        functionName: "convertToShares",
        args: [usdcAmount],
      })) as bigint;

      if (shares === 0n) {
        throw new Error(
          `convertToShares(${amount}) returned 0 for ${protocol.name}. The vault may be empty or the amount is too small.`,
        );
      }

      // Cap to user's actual balance so we don't try to redeem more than held
      const balance = (await this.client.readContract({
        address: vaultAddr,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddress],
      })) as bigint;

      return shares > balance ? balance : shares;
    }

    throw new Error(`Unknown amountType: ${amountType}`);
  }

  private async fullBalance(
    protocol: ProtocolEntry,
    walletAddress: Address,
    balanceTokenOverride?: Address,
  ): Promise<bigint> {
    const token = balanceTokenOverride ?? this.vaultTokenAddress(protocol);
    const balance = (await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    })) as bigint;

    if (balance === 0n) {
      throw new Error(
        `No ${protocol.name} shares held by ${walletAddress}. Nothing to withdraw.`,
      );
    }
    return balance;
  }

  private async minUsdcOut(
    protocol: ProtocolEntry,
    shares: bigint,
    aerodromePool?: string,
  ): Promise<bigint> {
    if (shares === 0n) return 0n;
    // Aerodrome: gauge shares are LP-pool units (18dp), not USDC — the
    // CompoundV3 "shares IS USDC 1:1" shortcut below silently misread the
    // raw share count as raw USDC units, inflating the preview by orders
    // of magnitude. Quote via real pool reserves + a live swap quote
    // instead — the same calculation the actual withdraw transactions use
    // (see AerodromeVaultService.buildDirectWithdrawTxs).
    if (protocol.aerodromePools) {
      const { expectedUsdcOut } = await this.aerodromeVault.buildRedeemData(shares, aerodromePool);
      return (expectedUsdcOut * 9950n) / 10000n;
    }
    // Compound V3: balance IS USDC (1:1), no ERC-4626 conversion needed.
    if (!this.isPositionErc4626(protocol)) {
      return (shares * 9950n) / 10000n;
    }
    const preview = (await this.client.readContract({
      address: this.vaultTokenAddress(protocol),
      abi: erc4626Abi,
      functionName: "previewRedeem",
      args: [shares],
    })) as bigint;
    // 0.5% slippage
    return (preview * 9950n) / 10000n;
  }
}
