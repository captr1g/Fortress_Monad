"use client";

import type { FortressPlan, StrategyStep } from "@/lib/api";
import { tokenSymbol } from "@/lib/tokens";

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
  strategy: "Strategy",
};

const STEP_LABELS: Record<StrategyStep["action"], string> = {
  swap: "Swap",
  supplyCollateral: "Supply collateral",
  borrow: "Borrow",
  repay: "Repay",
  withdrawCollateral: "Withdraw collateral",
};

type StepGroup = { label: string; steps: { step: StrategyStep; index: number }[] };

// Split resolved strategy steps into readable groups: everything before the first
// borrow is the "Entry" setup, then each borrow starts a new loop iteration.
function groupSteps(steps: StrategyStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let loop = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.action === "borrow") {
      loop += 1;
      groups.push({ label: `Loop ${loop}`, steps: [] });
    } else if (groups.length === 0) {
      groups.push({ label: "Entry", steps: [] });
    }
    groups[groups.length - 1].steps.push({ step, index: i });
  }
  return groups;
}

// One-line human description of a resolved step using live token symbols.
function describeStep(step: StrategyStep): string {
  const tokenIn = tokenSymbol(step.tokenIn);
  const tokenOut = step.tokenOut ? tokenSymbol(step.tokenOut) : null;
  const market = step.protocolData?.marketId;
  const ltv = step.protocolData?.targetLtv;

  switch (step.action) {
    case "swap":
      return `${tokenIn} → ${tokenOut ?? "?"}`;
    case "supplyCollateral":
      return `${tokenIn}${market ? ` into ${market}` : ""}`;
    case "borrow":
      return `${tokenIn}${market ? ` from ${market}` : ""}${
        ltv != null ? ` at ${(ltv * 100).toFixed(0)}% LTV` : ""
      }`;
    case "repay":
      return `${tokenIn}${market ? ` to ${market}` : ""}`;
    case "withdrawCollateral":
      return `${tokenIn}${market ? ` from ${market}` : ""}`;
    default:
      return tokenIn;
  }
}

function stepSizing(step: StrategyStep): string {
  if (step.amountFixed) return "fixed amount";
  if (step.bps === 10000) return "100% of balance";
  return `${(step.bps / 100).toFixed(0)}% of balance`;
}

export function PreviewCard({ plan, onConfirm, onReject, confirming }: Props) {
  const { intent, description, transactions, simulation, apy, depositApy } = plan;

  const fmtPct = (v: number | null | undefined) =>
    v === null || v === undefined ? "—" : `${(v * 100).toFixed(2)}%`;

  const strategySteps =
    intent.action === "strategy" && Array.isArray((intent as { steps?: unknown }).steps)
      ? ((intent as unknown as { steps: StrategyStep[] }).steps)
      : null;
  const stepGroups = strategySteps ? groupSteps(strategySteps) : null;

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
          {strategySteps && (
            <div>
              <span className="text-zinc-500">Steps: </span>
              <span className="text-zinc-300">{strategySteps.length}</span>
            </div>
          )}
        </div>
      </div>

      {apy && (
        <div className="px-5 py-3 border-b border-zinc-800">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Yield
          </h4>
          {apy.netApy.status === "ok" ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
              <div>
                <span className="text-zinc-500">Net APY: </span>
                <span className={apy.netApy.value! >= 0 ? "text-green-400" : "text-red-400"}>
                  {fmtPct(apy.netApy.value)}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Base: </span>
                <span className="text-zinc-300">{fmtPct(apy.baseApy)}</span>
              </div>
              <div>
                <span className="text-zinc-500">Leverage: </span>
                <span className="text-zinc-300">{apy.leverage.toFixed(2)}x</span>
              </div>
              <div>
                <span className="text-zinc-500">Collateral: </span>
                <span className="text-green-400">{fmtPct(apy.collateralApy.value)}</span>
              </div>
              <div>
                <span className="text-zinc-500">Borrow: </span>
                <span className="text-red-400">{fmtPct(apy.borrowApy.value)}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-400">APY temporarily unavailable</p>
          )}
        </div>
      )}

      {depositApy && (
        <div className="px-5 py-3 border-b border-zinc-800">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Yield
          </h4>
          {depositApy.netApy !== null ? (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs font-mono">
              <div>
                <span className="text-zinc-500">Net APY: </span>
                <span className={depositApy.netApy >= 0 ? "text-green-400" : "text-red-400"}>
                  {fmtPct(depositApy.netApy)}
                </span>
              </div>
              {depositApy.legs.map((leg, i) => (
                <div key={i}>
                  <span className="text-zinc-500">{leg.protocol}: </span>
                  <span className={leg.status === "ok" ? "text-zinc-300" : "text-amber-400"}>
                    {leg.status === "ok" ? fmtPct(leg.apy) : "unavailable"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-400">APY temporarily unavailable</p>
          )}
        </div>
      )}

      {stepGroups && (
        <div className="px-5 py-3 border-b border-zinc-800">
          <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
            Execution steps
          </h4>
          <div className="space-y-3">
            {stepGroups.map((group, gi) => (
              <div key={gi}>
                <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.steps.map(({ step, index }) => (
                    <div key={index} className="text-xs font-mono flex gap-2">
                      <span className="text-zinc-600 w-5 shrink-0 text-right">{index}.</span>
                      <span className="text-zinc-300">{STEP_LABELS[step.action]}</span>
                      <span className="text-zinc-400">{describeStep(step)}</span>
                      <span className="text-zinc-600 ml-auto">{stepSizing(step)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
