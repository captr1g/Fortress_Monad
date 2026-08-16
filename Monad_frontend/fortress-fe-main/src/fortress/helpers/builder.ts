import { encodeFunctionData } from "viem";
import { fortVaultAbi, crossChainRouterAbi, erc20Abi } from "../utils/abi.js";
import type { FortressConfig, ProtocolEntry } from "../utils/config.js";
import type {
  Intent,
  DepositIntentType,
  WithdrawIntentType,
  RebalanceIntentType,
} from "../types/intent.js";

export type UnsignedTransaction = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  chainId: number;
};

export type BuildResult = {
  transactions: UnsignedTransaction[];
  description: string;
};

export class CalldataBuilder {
  constructor(private readonly config: FortressConfig) {}

  build(intent: Intent): BuildResult {
    switch (intent.action) {
      case "deposit": return this.buildDeposit(intent);
      case "withdraw": return this.buildWithdraw(intent);
      case "rebalance": return this.buildRebalance(intent);
      case "claimWithdraw": return this.buildRequestCall(intent.requestId, "claimWithdraw", "Claim cross-chain withdrawal");
      case "cancelWithdraw": return this.buildRequestCall(intent.requestId, "cancelWithdraw", "Cancel pending withdrawal");
      case "swapAndDeposit":
      case "bridge":
        throw new Error(`${intent.action} must be resolved with LiFi data before building`);
      case "strategy":
        throw new Error("strategy must be resolved with StrategyBuilder before building");
      case "refuse": throw new Error(intent.reason);
    }
  }

  private buildDeposit(intent: DepositIntentType): BuildResult {
    const total = BigInt(intent.amount);
    const entries = intent.allocations.map((a) => ({
      protocolKey: this.resolveProtocol(a.protocol).key,
      amount: (total * BigInt(a.bps)) / 10000n,
      data: "0x" as `0x${string}`,
    }));

    // Last entry absorbs rounding remainder so the full amount is deposited
    const allocated = entries.reduce((sum, e) => sum + e.amount, 0n);
    if (allocated < total) {
      entries[entries.length - 1].amount += total - allocated;
    }

    const txs: UnsignedTransaction[] = [
      this.approval(this.config.usdc, this.config.vault, total),
      {
        to: this.config.vault,
        data: encodeFunctionData({ abi: fortVaultAbi, functionName: "deposit", args: [entries] }),
        value: 0n,
        chainId: this.config.chainId,
      },
    ];

    return { transactions: txs, description: `Deposit ${intent.amount} USDC across ${entries.length} protocol(s)` };
  }

  private buildWithdraw(intent: WithdrawIntentType): BuildResult {
    const entries = intent.entries.map((e) => ({
      protocolKey: this.resolveProtocol(e.protocol).key,
      shares: BigInt(e.shares),
      data: "0x" as `0x${string}`,
    }));

    const tx: UnsignedTransaction = {
      to: this.config.vault,
      data: encodeFunctionData({ abi: fortVaultAbi, functionName: "withdraw", args: [entries] }),
      value: 0n,
      chainId: this.config.chainId,
    };

    return { transactions: [tx], description: `Withdraw from ${entries.length} protocol(s)` };
  }

  private buildRebalance(intent: RebalanceIntentType): BuildResult {
    const entries = intent.entries.map((e) => ({
      fromProtocol: this.resolveProtocol(e.from).key,
      toProtocol: this.resolveProtocol(e.to).key,
      shares: BigInt(e.shares),
      fromData: "0x" as `0x${string}`,
      toData: "0x" as `0x${string}`,
    }));

    const tx: UnsignedTransaction = {
      to: this.config.vault,
      data: encodeFunctionData({ abi: fortVaultAbi, functionName: "rebalance", args: [entries] }),
      value: 0n,
      chainId: this.config.chainId,
    };

    return { transactions: [tx], description: `Rebalance ${entries.length} position(s)` };
  }

  private buildRequestCall(
    requestId: string,
    fn: "claimWithdraw" | "cancelWithdraw",
    description: string,
  ): BuildResult {
    const tx: UnsignedTransaction = {
      to: this.config.crossChainRouter,
      data: encodeFunctionData({ abi: crossChainRouterAbi, functionName: fn, args: [requestId as `0x${string}`] }),
      value: 0n,
      chainId: this.config.chainId,
    };
    return { transactions: [tx], description };
  }

  private approval(token: `0x${string}`, spender: `0x${string}`, amount: bigint): UnsignedTransaction {
    return {
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
      value: 0n,
      chainId: this.config.chainId,
    };
  }

  private resolveProtocol(name: string): ProtocolEntry {
    const found = this.config.protocols.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      throw new Error(`Unknown protocol: "${name}". Available: ${this.config.protocols.map((p) => p.name).join(", ")}`);
    }
    return found;
  }
}
