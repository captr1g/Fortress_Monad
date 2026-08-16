import {
  encodeFunctionData,
  createPublicClient,
  http,
  type PublicClient,
  type Address,
} from "viem";
import { base } from "viem/chains";
import {
  fortVaultAbi,
  fortVaultFeeAbi,
  crossChainRouterAbi,
  erc20Abi,
  erc4626Abi,
  cometAbi,
} from "../config/base_abi.js";
import { resolveProtocolEntry, type EvmChainConfig, type ProtocolEntry } from "../types.js";
import type {
  Intent,
  DepositIntentType,
  WithdrawIntentType,
  RebalanceIntentType,
} from "@domains/yield/types/intent.js";
import type { EvmTransaction, BuildResult } from "../types.js";
import { PendleVaultService } from "../protocols/pendle/pendle-vault.service.js";
import { AerodromeVaultService } from "../protocols/aerodrome/aerodrome-vault.service.js";
import { MIN_OUT_BPS } from "@domains/yield/types/market.js";

export class CalldataBuilder {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly client: any;
  private readonly pendleVault: PendleVaultService;
  private readonly aerodromeVault: AerodromeVaultService;
  private cachedFeeBps: bigint | null = null;

  constructor(private readonly config: EvmChainConfig) {
    this.client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
    this.pendleVault = new PendleVaultService(config);
    this.aerodromeVault = new AerodromeVaultService(config);
  }

  /// Reads the current deposit fee from the vault (cached per builder instance).
  /// Returns 0n if the read fails (graceful degradation — slippage slightly tighter).
  private async getDepositFeeBps(): Promise<bigint> {
    if (this.cachedFeeBps !== null) return this.cachedFeeBps;
    try {
      const fee = (await this.client.readContract({
        address: this.config.vault,
        abi: fortVaultFeeAbi,
        functionName: "depositFeeBps",
      })) as number;
      this.cachedFeeBps = BigInt(fee);
    } catch {
      this.cachedFeeBps = 0n;
    }
    return this.cachedFeeBps;
  }

  /// Applies the deposit fee to an amount, returning the net amount after fee deduction.
  /// Mirrors the on-chain _collectFee: net = amount - (amount * feeBps / 10000).
  private applyFee(amount: bigint, feeBps: bigint): bigint {
    if (feeBps === 0n) return amount;
    const fee = (amount * feeBps) / 10000n;
    return amount - fee;
  }

  // The Pendle fixed-yield venue needs per-market route data (IFortProtocolEx).
  private isPendleVault(protocol: ProtocolEntry): boolean {
    return protocol.pendleVaultMarkets !== undefined;
  }

  private isAerodromeVault(protocol: ProtocolEntry): boolean {
    return protocol.aerodromePools !== undefined && protocol.aerodromePools.length > 0;
  }

  async build(
    intent: Intent,
    walletAddress?: Address,
  ): Promise<BuildResult> {
    switch (intent.action) {
      case "deposit":
        return this.buildDeposit(intent);
      case "withdraw":
        return this.buildWithdraw(intent, walletAddress);
      case "rebalance":
        return this.buildRebalance(intent, walletAddress);
      case "claimWithdraw":
        return this.buildRequestCall(
          intent.requestId,
          "claimWithdraw",
          "Claim cross-chain withdrawal",
        );
      case "cancelWithdraw":
        return this.buildRequestCall(
          intent.requestId,
          "cancelWithdraw",
          "Cancel pending withdrawal",
        );
      case "swapAndDeposit":
      case "bridge":
        throw new Error(
          `${intent.action} must be resolved with LiFi data before building`,
        );
      case "strategy":
        throw new Error(
          "strategy must be resolved with StrategyBuilder before building",
        );
      case "leverage":
        throw new Error(
          "leverage must be resolved with LeverageService before building",
        );
      case "refuse":
        throw new Error(intent.reason);
    }
  }

  // From total amount -> as per bps amount is splited (last one get complete) -> build entries for deposit function
  private async buildDeposit(intent: DepositIntentType): Promise<BuildResult> {
    const total = BigInt(intent.amount);
    const feeBps = await this.getDepositFeeBps();
    const netTotal = this.applyFee(total, feeBps);

    const amounts = intent.allocations.map(
      (a) => (total * BigInt(a.bps)) / 10000n,
    );

    // Last entry absorbs rounding remainder so the full amount is deposited.
    const allocated = amounts.reduce((sum, a) => sum + a, 0n);
    if (allocated < total) {
      amounts[amounts.length - 1] += total - allocated;
    }

    // Compute the net (post-fee) amount each protocol actually receives on-chain.
    // The contract does: entryNetAmount = (entries[i].amount * netTotal) / total
    // (with last-entry-gets-remainder). We mirror this for accurate minSharesOut.
    const netAmounts = amounts.map((a, i) => {
      if (i === amounts.length - 1) {
        const priorNet = amounts.slice(0, -1).reduce(
          (sum, x) => sum + (x * netTotal) / total, 0n
        );
        return netTotal - priorNet;
      }
      return (a * netTotal) / total;
    });

    const entries = await Promise.all(
      intent.allocations.map(async (a, i) => {
        const protocol = this.resolveProtocol(a.protocol);

        // Pendle fixed-yield venue: buy PT via IFortProtocolEx (needs encoded route data).
        if (this.isPendleVault(protocol)) {
          const { data, expectedPtOut } =
            await this.pendleVault.buildDepositData(netAmounts[i], a.pendleMarket);
          return {
            protocolKey: protocol.key,
            amount: amounts[i],
            minSharesOut: (expectedPtOut * 9950n) / 10000n,
            data,
          };
        }

        // Aerodrome LP: swap half → paired token, add liquidity, stake in gauge.
        if (this.isAerodromeVault(protocol)) {
          const { data } =
            await this.aerodromeVault.buildDepositData(netAmounts[i], a.aerodromePool);
          return {
            protocolKey: protocol.key,
            amount: amounts[i],
            // LP output is hard to predict exactly; use 0 as minSharesOut and rely
            // on the encoded amountAMin/amountBMin for slippage protection instead.
            minSharesOut: 0n,
            data,
          };
        }

        return {
          protocolKey: protocol.key,
          amount: amounts[i],
          // Compute minSharesOut off the NET amount the protocol will actually receive.
          minSharesOut: await this.minSharesOut(protocol, netAmounts[i]),
          data: "0x" as Address,
        };
      }),
    );

    const txs: EvmTransaction[] = [
      this.approval(this.config.usdc, this.config.vault, total),
      {
        to: this.config.vault,
        data: encodeFunctionData({
          abi: fortVaultAbi,
          functionName: "deposit",
          args: [entries],
        }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];

    return {
      transactions: txs,
      description: `Deposit ${intent.amount} USDC across ${entries.length} protocol(s)`,
    };
  }

  // Resolve (protocol + amount/shares + amountType) -> build entries -> get approvals -> build transaction
  private async buildWithdraw(
    intent: WithdrawIntentType,
    walletAddress?: Address,
  ): Promise<BuildResult> {
    const resolved = (await Promise.all(
      intent.entries.map(async (e) => {
        const protocol = this.resolveProtocol(e.protocol);
        try {
          const shares = await this.resolveWithdrawShares(
            protocol,
            e,
            walletAddress,
          );
          return { protocol, shares, pendleMarket: e.pendleMarket };
        } catch (err: unknown) {
          // For multi-protocol withdrawals ("withdraw from all"), skip
          // protocols where the user has zero balance rather than failing
          // the entire request.
          if (intent.entries.length > 1) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("shares held by") || msg.includes("Nothing to withdraw") || msg.includes("valuation is too low")) {
              return null;
            }
          }
          throw err;
        }
      }),
    )).filter((r): r is NonNullable<typeof r> => r !== null);

    if (resolved.length === 0) {
      throw new Error("No positions found to withdraw across the requested protocols.");
    }

    // ERC-4626 / Compound legs redeem to USDC natively, so they go through
    // FortVault.withdraw. Pendle PT is not a USDC share — exiting requires a real
    // swap (PT → SY → underlying → USDC), and for markets whose SY does not unwrap
    // 1:1 to USDC (e.g. 40acresUSDC) that needs an aggregator hop the vault adapter
    // cannot route. So Pendle legs exit via a direct Pendle RouterV4 call instead.
    const pendleLegs = resolved.filter((r) => this.isPendleVault(r.protocol));
    const aeroLegs = resolved.filter((r) => this.isAerodromeVault(r.protocol));
    const vaultLegs = resolved.filter((r) => !this.isPendleVault(r.protocol) && !this.isAerodromeVault(r.protocol));

    const txs: EvmTransaction[] = [];

    // Standard vault withdraw (ERC-4626, Compound, Yo — no data needed)
    if (vaultLegs.length > 0) {
      const entries = await Promise.all(
        vaultLegs.map(async ({ protocol, shares }) => ({
          protocolKey: protocol.key,
          shares,
          minUsdcOut: await this.minUsdcOut(protocol, shares),
          data: "0x" as Address,
        })),
      );
      const approvals = await this.withdrawApprovals(vaultLegs, walletAddress);
      txs.push(...approvals);
      txs.push({
        to: this.config.vault,
        data: encodeFunctionData({
          abi: fortVaultAbi,
          functionName: "withdraw",
          args: [entries],
        }),
        value: 0n,
        chainId: this.config.chainId,
      });
    }

    // Aerodrome: gauge tokens are non-transferable. Direct user-side flow:
    // 1. Unstake from gauge → LP to user
    // 2. Approve LP to Aerodrome Router
    // 3. removeLiquidity via router (USDC + paired token → user)
    // 4. Swap paired token → USDC via router
    // This bypasses the vault/adapter entirely (similar to Pendle's direct redeem).
    if (aeroLegs.length > 0) {
      for (const { protocol, shares, pendleMarket } of aeroLegs) {
        // Use the aerodromePool from the withdraw entry to target the correct gauge
        const matchedEntry = intent.entries.find(
          (e) => e.protocol.toLowerCase() === protocol.name.toLowerCase(),
        );
        const pool = this.aerodromeVault.resolvePool(matchedEntry?.aerodromePool);
        const aeroTxs = await this.aerodromeVault.buildDirectWithdrawTxs(
          shares,
          walletAddress!,
          pool,
          this.config.chainId,
        );
        txs.push(...aeroTxs);
      }
    }

    for (const leg of pendleLegs) {
      if (!walletAddress) {
        throw new Error("Wallet address required for Pendle withdrawal.");
      }
      // Direct Pendle Router redeem, receiver = user (USDC lands in the wallet).
      // Pendle's aggregator route cannot handle dust amounts — small partial
      // swaps (e.g. 25% of a $0.30 position) fail at the SDK level with a 400
      // "transfer amount exceeds balance" error from the external DEX sim.
      // When a partial amount fails, fall back to the full balance (with margin)
      // so the user can still exit their position.
      const redeemResult = await this.buildPendleRedeemWithFallback(
        leg,
        walletAddress,
      );
      const { to, data, value, pt } = redeemResult;
      // Approve the router for the exact shares + 0.1% buffer (Pendle's aggregator
      // route can round the internal amount up by a few wei).
      const approveAmount = leg.shares + (leg.shares / 1000n) + 1n;
      txs.push(this.approval(pt, to, approveAmount));
      txs.push({ to, data, value, chainId: this.config.chainId });
    }

    return {
      transactions: txs,
      description: `Withdraw from ${resolved.length} protocol(s)`,
    };
  }

  /**
   * Attempts to build the Pendle redeem with the requested shares. If Pendle's
   * aggregator API rejects the amount (typically dust that can't route through
   * the external DEX), retries with the full PT balance (minus the 0.01% margin).
   * This means a user with $0.30 in PT who asks for "50%" will get their full
   * balance redeemed rather than a cryptic API error.
   */
  private async buildPendleRedeemWithFallback(
    leg: { shares: bigint; pendleMarket?: string; protocol?: ProtocolEntry },
    walletAddress: Address,
  ): Promise<{
    to: Address;
    data: Address;
    value: bigint;
    pt: Address;
    minTokenOut: bigint;
  }> {
    try {
      return await this.pendleVault.buildDirectRedeem(
        leg.shares,
        walletAddress,
        leg.pendleMarket,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on the known dust/aggregator failure pattern from Pendle API.
      const isDustFailure =
        msg.includes("transfer amount exceeds balance") ||
        msg.includes("simulation failed") ||
        msg.includes("input valuation is too low") ||
        msg.includes("minimum valuation") ||
        (msg.includes("redeem quote failed") && msg.includes("400"));

      if (!isDustFailure) throw err;

      // Fall back to full balance with the standard 0.01% margin.
      const protocol = this.config.protocols.find(
        (p) => p.pendleVaultMarkets !== undefined,
      );
      if (!protocol) throw err;

      const fullBalance = await this.positionBalance(
        protocol,
        walletAddress,
        leg.pendleMarket,
      );
      if (fullBalance === 0n) throw err;

      const margin = fullBalance / 10000n;
      const safeShares =
        margin > 0n ? fullBalance - margin : fullBalance > 0n ? fullBalance - 1n : 0n;

      // If the requested amount was already essentially the full balance, re-throw.
      if (leg.shares >= safeShares) {
        throw new Error(
          "Pendle position is too small to withdraw (below Pendle's $0.01 minimum). Wait for the market to mature or deposit more first.",
        );
      }

      try {
        return await this.pendleVault.buildDirectRedeem(
          safeShares,
          walletAddress,
          leg.pendleMarket,
        );
      } catch (retryErr: unknown) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (retryMsg.includes("valuation is too low") || retryMsg.includes("minimum valuation")) {
          throw new Error(
            "Pendle position is too small to withdraw (below Pendle's $0.01 minimum). Wait for the market to mature or deposit more first.",
          );
        }
        throw retryErr;
      }
    }
  }

  /**
   * Resolves withdraw amount to shares based on amountType:
   * - "shares" or missing: use raw shares field (0 = full balance)
   * - "usdc": convert USDC amount to shares via ERC-4626 convertToShares
   * - "percent": compute percentage of user's share balance
   * - "all": full balance
   */
  private async resolveWithdrawShares(
    protocol: ProtocolEntry,
    entry: {
      shares?: string;
      amount?: string;
      amountType?: string;
      pendleMarket?: string;
    },
    walletAddress?: Address,
  ): Promise<bigint> {
    const amountType = entry.amountType ?? "shares";

    // Pendle shares are PT token units — usdc conversion doesn't apply.
    // For multi-protocol withdrawals the planner may send "usdc" for all entries;
    // silently treat Pendle/Aerodrome as "all" so the request doesn't fail
    // (their shares aren't USDC-denominated).
    if ((this.isPendleVault(protocol) || this.isAerodromeVault(protocol)) && amountType === "usdc") {
      return this.resolveShares(protocol, "0", walletAddress, entry.pendleMarket);
    }

    // "all" → full balance
    if (amountType === "all") {
      return this.resolveShares(
        protocol,
        "0",
        walletAddress,
        entry.pendleMarket,
      );
    }

    // "percent" → read balance, apply percentage
    if (amountType === "percent") {
      const pct = Number(entry.amount ?? "0");
      if (pct <= 0 || pct > 100) {
        throw new Error(`percent must be 1–100, got ${pct}`);
      }
      if (!walletAddress) {
        throw new Error("Wallet address required for percentage withdrawal.");
      }
      const balance = await this.positionBalance(
        protocol,
        walletAddress,
        entry.pendleMarket,
      );
      if (balance === 0n) {
        throw new Error(`No ${protocol.name} shares held by ${walletAddress}.`);
      }
      return (balance * BigInt(Math.round(pct * 100))) / 10000n;
    }

    // "usdc" → convert USDC amount to redeemable units
    if (amountType === "usdc") {
      const usdcAmount = BigInt(entry.amount ?? "0");
      if (usdcAmount === 0n) {
        return this.resolveShares(protocol, "0", walletAddress);
      }
      // Compound V3 balance is USDC-denominated (1:1), so the "shares" are the USDC amount.
      if (!protocol.isERC4626) {
        if (!protocol.positionToken) {
          throw new Error(
            `Cannot convert USDC to shares for non-ERC4626 protocol "${protocol.name}".`,
          );
        }
        if (!walletAddress) return usdcAmount;
        const balance = await this.positionBalance(protocol, walletAddress);
        return usdcAmount > balance ? balance : usdcAmount;
      }
      const shares = (await this.client.readContract({
        address: protocol.address,
        abi: erc4626Abi,
        functionName: "convertToShares",
        args: [usdcAmount],
      })) as bigint;
      if (shares === 0n) {
        throw new Error(
          `convertToShares(${usdcAmount}) returned 0 for ${protocol.name}.`,
        );
      }
      // Cap to user's actual balance
      if (walletAddress) {
        const balance = await this.positionBalance(protocol, walletAddress);
        return shares > balance ? balance : shares;
      }
      return shares;
    }

    // "shares" (default / legacy) → use raw shares field
    return this.resolveShares(protocol, entry.shares ?? "0", walletAddress);
  }

  // Resolve (from protocol + to protocol + shares) -> build entries -> get approvals -> build transaction
  private async buildRebalance(
    intent: RebalanceIntentType,
    walletAddress?: Address,
  ): Promise<BuildResult> {
    const resolved = await Promise.all(
      intent.entries.map(async (e) => {
        const from = this.resolveProtocol(e.from);
        const to = this.resolveProtocol(e.to);

        // Pendle deposit data is amount-specific (ApproxParams); rebalance amounts are
        // only known at runtime (after the redeem), so we cannot build safe deposit data.
        if (this.isPendleVault(from) || this.isPendleVault(to)) {
          throw new Error(
            "Rebalance involving Pendle (fixed yield) is not supported. Withdraw from Pendle first, then deposit separately.",
          );
        }

        // Aerodrome gauge is non-transferable — can't rebalance FROM it via vault.
        if (this.isAerodromeVault(from)) {
          throw new Error(
            "Rebalance from Aerodrome is not supported (gauge tokens are non-transferable). Withdraw from Aerodrome first, then deposit separately.",
          );
        }

        const shares = await this.resolveShares(from, e.shares, walletAddress);
        return { from, to, shares };
      }),
    );

    const entries = await Promise.all(
      resolved.map(async ({ from, to, shares }) => {
        const minUsdcOut = await this.minUsdcOut(from, shares);
        const minSharesOut = await this.minSharesOut(to, minUsdcOut);

        // Aerodrome needs encoded deposit data (poolKey, swap mins, deadline).
        let toData: Address = "0x" as Address;
        if (this.isAerodromeVault(to) && minUsdcOut > 0n) {
          const { data } = await this.aerodromeVault.buildDepositData(minUsdcOut);
          toData = data;
        }

        return {
          fromProtocol: from.key,
          toProtocol: to.key,
          shares,
          minUsdcOut,
          minSharesOut,
          fromData: "0x" as Address,
          toData,
        };
      }),
    );

    // Vault pulls each source position; ERC-4626 needs an approve, Compound needs allow().
    const approvals = await this.withdrawApprovals(
      resolved.map((r) => ({ protocol: r.from, shares: r.shares })),
      walletAddress,
    );

    const tx: EvmTransaction = {
      to: this.config.vault,
      data: encodeFunctionData({
        abi: fortVaultAbi,
        functionName: "rebalance",
        args: [entries],
      }),
      value: 0n,
      chainId: this.config.chainId,
    };

    return {
      transactions: [...approvals, tx],
      description: `Rebalance ${entries.length} position(s)`,
    };
  }

  //  Builds a cross-chain request call (claim or cancel).
  private buildRequestCall(
    requestId: string,
    fn: "claimWithdraw" | "cancelWithdraw",
    description: string,
  ): BuildResult {
    const tx: EvmTransaction = {
      to: this.config.crossChainRouter,
      data: encodeFunctionData({
        abi: crossChainRouterAbi,
        functionName: fn,
        args: [requestId as Address],
      }),
      value: 0n,
      chainId: this.config.chainId,
    };
    return { transactions: [tx], description };
  }

  // Resolves a share amount string. "0" means "use full balance" — read from the
  // protocol's balance token (the ERC-4626 share token, or the position token for
  // rebasing venues like Compound V3). Requires walletAddress.
  private async resolveShares(
    protocol: ProtocolEntry,
    shares: string,
    walletAddress?: Address,
    pendleMarket?: string,
  ): Promise<bigint> {
    const requested = BigInt(shares);
    if (requested > 0n) return requested;

    if (!this.balanceToken(protocol) && !this.isPendleVault(protocol)) {
      throw new Error(
        `Cannot resolve full balance for "${protocol.name}"; specify an explicit share amount.`,
      );
    }
    if (!walletAddress) {
      throw new Error("Wallet address required to resolve full share balance.");
    }

    const balance = await this.positionBalance(
      protocol,
      walletAddress,
      pendleMarket,
    );
    if (balance === 0n) {
      throw new Error(
        `No ${protocol.name} shares held by ${walletAddress} to redeem.`,
      );
    }
    // Pendle PT balances can shift between blocks due to SY accounting rounding.
    // Shave a tiny margin (0.01%) so the tx never exceeds the live balance at mine time.
    if (this.isPendleVault(protocol)) {
      const margin = balance / 10000n; // 0.01%
      return margin > 0n ? balance - margin : balance - 1n;
    }
    return balance;
  }

  // The token whose balanceOf represents the user's position: ERC-4626 share token
  // (== protocol address), Comet rebasing token, or PT token for Pendle vault.
  private balanceToken(protocol: ProtocolEntry): Address | undefined {
    if (protocol.isERC4626) return protocol.address;
    if (protocol.positionToken) return protocol.positionToken;
    // Pendle vault: the PT address is resolved async — balance reads go through positionBalance.
    return undefined;
  }

  // Reads the user's position balance from the protocol's balance token.
  // For Pendle vault, resolves the default PT address on demand.
  private async positionBalance(
    protocol: ProtocolEntry,
    walletAddress: Address,
    pendleMarket?: string,
  ): Promise<bigint> {
    let token = this.balanceToken(protocol);
    if (!token && this.isPendleVault(protocol)) {
      token = await this.pendleVault.ptToken(pendleMarket);
    }
    if (!token) {
      throw new Error(
        `Protocol "${protocol.name}" has no readable balance token.`,
      );
    }
    return (await this.client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [walletAddress],
    })) as bigint;
  }

  // Minimum shares for a named protocol deposit. Used by swapAndDeposit resolution.
  async minSharesForProtocol(
    protocol: ProtocolEntry,
    assets: bigint,
  ): Promise<bigint> {
    return this.minSharesOut(protocol, assets);
  }

  // Minimum shares for an ERC-4626 deposit, derived from a live previewDeposit minus slippage.
  private async minSharesOut(
    protocol: ProtocolEntry,
    assets: bigint,
  ): Promise<bigint> {
    if (!protocol.isERC4626 || assets === 0n) return 0n;
    try {
      const preview = (await this.client.readContract({
        address: protocol.address,
        abi: erc4626Abi,
        functionName: "previewDeposit",
        args: [assets],
      })) as bigint;
      return (preview * MIN_OUT_BPS) / 10000n;
    } catch {
      // Fallback estimation (1:1 with slippage bound) if preview reverts or RPC lacks contract
      return (assets * MIN_OUT_BPS) / 10000n;
    }
  }

  // Minimum USDC for an ERC-4626 redeem, derived from a live previewRedeem minus slippage.
  private async minUsdcOut(
    protocol: ProtocolEntry,
    shares: bigint,
  ): Promise<bigint> {
    if (!protocol.isERC4626 || shares === 0n) return 0n;
    try {
      const preview = (await this.client.readContract({
        address: protocol.address,
        abi: erc4626Abi,
        functionName: "previewRedeem",
        args: [shares],
      })) as bigint;
      return (preview * MIN_OUT_BPS) / 10000n;
    } catch {
      // Fallback estimation (1:1 with slippage bound) if preview reverts or RPC lacks contract
      return (shares * MIN_OUT_BPS) / 10000n;
    }
  }

  // Builds the authorization txs the vault needs to pull each source position:
  // ERC-4626 → approve the vault on the share token; Compound V3 → allow the adapter
  // as a Comet manager (skipped when already allowed on-chain).
  private async withdrawApprovals(
    legs: { protocol: ProtocolEntry; shares: bigint }[],
    walletAddress?: Address,
  ): Promise<EvmTransaction[]> {
    const txs: EvmTransaction[] = [];
    for (const { protocol, shares } of legs) {
      if (shares <= 0n) continue;

      if (protocol.isERC4626) {
        txs.push(this.approval(protocol.address, this.config.vault, shares));
        continue;
      }

      // Non-ERC4626 with a positionToken. Two patterns exist:
      //  - Compound V3: positionToken is a Comet that uses manager-style `allow`.
      //  - Yo (adapter pattern): positionToken is a standard ERC-4626 vault the
      //    user holds directly; the adapter pulls via safeTransferFrom, so the user
      //    needs a standard ERC-20 approve on positionToken → adapter (protocol.address).
      if (protocol.positionToken) {
        const isComet = protocol.name === "CompoundV3";
        if (isComet) {
          if (await this.isCometAllowed(protocol, walletAddress)) continue;
          txs.push({
            to: protocol.positionToken,
            data: encodeFunctionData({
              abi: cometAbi,
              functionName: "allow",
              args: [protocol.address, true],
            }),
            value: 0n,
            chainId: this.config.chainId,
          });
        } else {
          // Standard ERC-20 approve: user approves the adapter to pull positionToken shares.
          txs.push(this.approval(protocol.positionToken, protocol.address, shares));
        }
      }
    }
    return txs;
  }

  // Whether the Compound adapter is already an allowed manager for the user's Comet
  // position. Unknown wallet → false so we emit the (idempotent) allow to be safe.
  private async isCometAllowed(
    protocol: ProtocolEntry,
    walletAddress?: Address,
  ): Promise<boolean> {
    if (!protocol.positionToken || !walletAddress) return false;
    return (await this.client.readContract({
      address: protocol.positionToken,
      abi: cometAbi,
      functionName: "isAllowed",
      args: [walletAddress, protocol.address],
    })) as boolean;
  }

  private approval(
    token: Address,
    spender: Address,
    amount: bigint,
  ): EvmTransaction {
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

  private resolveProtocol(name: string): ProtocolEntry {
    const found = resolveProtocolEntry(this.config.protocols, name);
    if (!found) {
      throw new Error(
        `Unknown protocol: "${name}". Available: ${this.config.protocols.map((p) => p.name).join(", ")}`,
      );
    }
    return found;
  }
}
