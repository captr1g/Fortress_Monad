"use client";

import type { FortressPlan } from "@/lib/api";

type Props = {
  plan: FortressPlan;
  onConfirm: () => void;
  onReject: () => void;
  confirming: boolean;
};

const ACTION_LABELS: Record<string, string> = {
  deposit: "Deposit",
  swapAndDeposit: "Swap & Deposit",
  withdraw: "Withdraw",
  rebalance: "Rebalance",
  bridge: "Bridge",
  claimWithdraw: "Claim Withdrawal",
  cancelWithdraw: "Cancel Withdrawal",
};

export function PreviewCard({ plan, onConfirm, onReject, confirming }: Props) {
  const { intent, description, transactions, simulation } = plan;

  return (
    <div className="rounded-xl border border-zinc-700 bg-[#12121a] overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-200">
            {ACTION_LABELS[intent.action] ?? intent.action}
          </h3>
          <p className="text-xs text-zinc-400 mt-1 font-mono">{description}</p>
        </div>
        <span
          className={`text-xs px-2 py-1 rounded-md font-medium ${
            simulation.success
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {simulation.success ? "Simulation OK" : "Simulation Failed"}
        </span>
      </div>

      {!simulation.success && simulation.error && (
        <div className="px-5 py-3 border-b border-zinc-800">
          <p className="text-xs text-red-400 font-mono break-all">{simulation.error}</p>
        </div>
      )}

      <div className="px-5 py-3 border-b border-zinc-800">
        <div className="flex gap-6 text-xs font-mono">
          <div>
            <span className="text-zinc-500">Gas: </span>
            <span className="text-zinc-300">{simulation.gasUsed}</span>
          </div>
          <div>
            <span className="text-zinc-500">Txs to sign: </span>
            <span className="text-zinc-300">{transactions.length}</span>
          </div>
        </div>
      </div>

      <div className="px-5 py-3 border-b border-zinc-800">
        <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
          Transactions
        </h4>
        <div className="space-y-1">
          {transactions.map((tx, i) => (
            <div key={i} className="text-xs text-zinc-400 font-mono">
              {i + 1}. → {tx.to.slice(0, 10)}…{tx.to.slice(-8)}{" "}
              <span className="text-zinc-600">(chain {tx.chainId})</span>
            </div>
          ))}
        </div>
      </div>

      <div className="px-5 py-4 flex gap-3">
        <button
          onClick={onConfirm}
          disabled={confirming || !simulation.success}
          className="flex-1 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 disabled:opacity-50 transition-colors"
        >
          {confirming ? "Executing…" : "Confirm & Sign"}
        </button>
        <button
          onClick={onReject}
          disabled={confirming}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-700 text-zinc-200 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          Reject
        </button>
      </div>
    </div>
  );
}
