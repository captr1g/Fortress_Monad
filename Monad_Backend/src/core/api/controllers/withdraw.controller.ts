import type { FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { createPublicClient, http, type Address } from "viem";
import { monad } from "viem/chains";
import type { WithdrawService } from "@chains/evm/contracts/vault-withdraw.js";
import type { CalldataBuilder } from "@chains/evm/contracts/vault-builder.js";
import type { EvmSimulator } from "@chains/evm/simulator.js";
import type { EvmChainConfig } from "@chains/evm/types.js";
import { PendleVaultService } from "@chains/evm/protocols/pendle/pendle-vault.service.js";
import { erc20Abi } from "@chains/evm/config/abi.js";
import { FortressLogger } from "@shared/logger.js";

const WithdrawRequestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenAddress: z.string().min(1),
  amount: z.string().min(1),
  amountType: z.enum(["shares", "usdc", "percent", "all"]).default("usdc"),
});

export class WithdrawController {
  private readonly service: WithdrawService;
  private readonly builder: CalldataBuilder;
  private readonly simulator: EvmSimulator;
  private readonly config: EvmChainConfig;
  private readonly pendleVault: PendleVaultService;

  constructor(
    service: WithdrawService,
    builder: CalldataBuilder,
    simulator: EvmSimulator,
    config: EvmChainConfig,
  ) {
    this.service = service;
    this.builder = builder;
    this.simulator = simulator;
    this.config = config;
    this.pendleVault = new PendleVaultService(config);
  }

  async withdraw(request: FastifyRequest, reply: FastifyReply) {
    const log = FortressLogger.newRequest().at({
      route: "POST /fortress/withdraw",
      file: "withdraw.controller.ts",
      fn: "withdraw",
    });

    const body = WithdrawRequestSchema.parse(request.body);
    const walletAddress = (request.walletAddress ?? body.walletAddress) as Address;

    log.action("withdraw");

    try {
      if (this.isPendlePtToken(body.tokenAddress)) {
        return await this.withdrawPendle(walletAddress, body, reply);
      }

      const result = await this.service.buildWithdraw(
        walletAddress,
        body.tokenAddress,
        body.amount,
        body.amountType,
      );

      return reply.status(200).send({
        description: result.description,
        protocol: result.protocol,
        shares: result.shares,
        minUsdcOut: result.minUsdcOut,
        transactions: result.transactions.map(serializeTx),
        simulation: serializeSim(result.simulation),
      });
    } catch (err: unknown) {
      log.error("WITHDRAW FAILED", err);
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(422).send({ error: { stage: "withdraw", message } });
    }
  }

  // ─── Pendle PT withdrawal ─────────────────────────────────────────────────

  private async withdrawPendle(
    walletAddress: Address,
    body: { tokenAddress: string; amount: string; amountType: string },
    reply: FastifyReply,
  ) {
    // 1. Build the withdraw transactions via the standard builder path.
    //    The builder resolves shares internally (including the 0.01% margin for
    //    full-balance withdrawals) and constructs the Pendle Router redeem tx.
    const { transactions, description } = await this.builder.build(
      {
        action: "withdraw" as const,
        entries: [
          { protocol: "Pendle", amount: body.amount, amountType: body.amountType },
        ],
      } as any,
      walletAddress,
    );

    // 2. Resolve the expected USDC output for the frontend display.
    //    This is purely informational — slippage protection is baked into the
    //    router calldata the builder already produced.
    const { shares, minUsdcOut } = await this.estimatePendleOutput(
      walletAddress,
      body.amount,
      body.amountType,
    );

    // 3. Simulate
    const simulation = await this.simulator.simulate(transactions, walletAddress);

    return reply.status(200).send({
      description,
      protocol: "Pendle",
      shares,
      minUsdcOut,
      transactions: transactions.map(serializeTx),
      simulation: serializeSim(simulation),
    });
  }

  // Resolves the PT shares for display and fetches a Pendle SDK quote for the
  // expected USDC output. Returns "0" gracefully if the quote is unavailable.
  private async estimatePendleOutput(
    walletAddress: Address,
    amount: string,
    amountType: string,
  ): Promise<{ shares: string; minUsdcOut: string }> {
    try {
      const client = createPublicClient({ chain: monad, transport: http(this.config.rpcUrl) });
      const ptAddress = await this.pendleVault.ptToken();

      const balance = (await client.readContract({
        address: ptAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [walletAddress],
      })) as bigint;

      let shares = this.resolvePendleShares(balance, amount, amountType);
      if (shares === 0n) return { shares: "0", minUsdcOut: "0" };

      try {
        const { minTokenOut } = await this.pendleVault.buildDirectRedeem(shares, walletAddress);
        return { shares: shares.toString(), minUsdcOut: minTokenOut.toString() };
      } catch (err: unknown) {
        // If the partial amount fails the aggregator (dust), retry with full balance.
        const msg = err instanceof Error ? err.message : String(err);
        const isDust =
          msg.includes("transfer amount exceeds balance") ||
          msg.includes("simulation failed") ||
          msg.includes("input valuation is too low") ||
          msg.includes("minimum valuation") ||
          (msg.includes("redeem quote failed") && msg.includes("400"));
        if (!isDust) throw err;

        // Upgrade to full balance with margin.
        const margin = balance / 10000n;
        shares = margin > 0n ? balance - margin : balance > 0n ? balance - 1n : 0n;
        const { minTokenOut } = await this.pendleVault.buildDirectRedeem(shares, walletAddress);
        return { shares: shares.toString(), minUsdcOut: minTokenOut.toString() };
      }
    } catch {
      return { shares: "0", minUsdcOut: "0" };
    }
  }

  // Mirrors the builder's share resolution for Pendle PT tokens.
  private resolvePendleShares(balance: bigint, amount: string, amountType: string): bigint {
    if (amountType === "all" || (amountType === "shares" && BigInt(amount) === 0n)) {
      const margin = balance / 10000n;
      return margin > 0n ? balance - margin : balance > 0n ? balance - 1n : 0n;
    }
    if (amountType === "percent") {
      const bps = BigInt(Math.round(Number(amount) * 100));
      return (balance * bps) / 10000n;
    }
    return BigInt(amount);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private isPendlePtToken(tokenAddress: string): boolean {
    const hasPendle = this.config.protocols.some(
      (p) => p.pendleVaultMarkets !== undefined,
    );
    if (!hasPendle) return false;

    const normalized = tokenAddress.toLowerCase();
    if (normalized === "pendle") return true;

    // If it matches a known protocol address, positionToken, or any Aerodrome
    // gauge address, it's not a PT token.
    const isKnownProtocolToken = this.config.protocols.some(
      (p) =>
        p.address.toLowerCase() === normalized ||
        (p.positionToken && p.positionToken.toLowerCase() === normalized) ||
        (p.aerodromePools && p.aerodromePools.some((pool) => pool.gauge.toLowerCase() === normalized)),
    );
    return !isKnownProtocolToken;
  }
}

// ─── Serializers ──────────────────────────────────────────────────────────────

function serializeTx(tx: { to: string; data: string; value: bigint; chainId: number }) {
  return { to: tx.to, data: tx.data, value: tx.value.toString(), chainId: tx.chainId };
}

function serializeSim(sim: { success: boolean; gasUsed: bigint; error?: string }) {
  return { success: sim.success, gasUsed: sim.gasUsed.toString(), error: sim.error ?? null };
}
