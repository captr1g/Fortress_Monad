"use client";

import { useState } from "react";
import { useValidatePlan, useExecutePlan, useSaveStrategy, useSavedStrategies, useSimulateWithAmount, useSendPlanCalls, MAX_SAVED_STRATEGIES } from "@fortress/core/hooks";
import { FortressApiError, humanizeError, type Preview } from "@fortress/core";
import { formatUnits, parseUnits } from "viem";
import { useToastStore } from "@/store/toast";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import type { Strategy } from "@/lib/strategy";
import { formatApy } from "@/lib/format";
import { StepList, countVisualSteps } from "./StepCard";
import { TokenIcon, VaultBadge, NetworkIcon } from "./icons";
import { useSimulation, type Simulation } from "./useSimulation";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { WalletGate } from "@/components/auth/WalletGate";
import { PromptComposer } from "./PromptComposer";

export function StrategyResult({
  strategy,
  planId,
  preview,
  onCancel,
  onRegenerate,
}: {
  strategy: Strategy;
  planId?: string;
  preview?: import("@fortress/core").Preview;
  onCancel?: () => void;
  onRegenerate?: (prompt: string, name: string) => void;
}) {
  const sim = useSimulation(strategy.steps.length);
  const [editedPrompt, setEditedPrompt] = useState(strategy.prompt);
  const [editedName, setEditedName] = useState(strategy.name);
  // Re-simulating at a new amount (inside DeployAction) produces a fresh
  // plan/preview — kept as local state, seeded from the incoming props, so
  // this component's own render reflects it immediately without needing its
  // callers to manage that state themselves.
  const [localPlanId, setLocalPlanId] = useState(planId);
  const [localPreview, setLocalPreview] = useState(preview);

  return (
    <div className="flex flex-1 gap-5 overflow-hidden p-[22px]">
      <aside className="flex w-[384px] flex-none flex-col gap-3.5">
        <PromptSummary
          strategy={strategy}
          prompt={editedPrompt}
          onChange={setEditedPrompt}
          onRegenerate={() => onRegenerate?.(editedPrompt, editedName)}
          hasChanges={editedPrompt !== strategy.prompt}
        />
        <SimulationPanel
          strategy={strategy}
          preview={localPreview}
          sim={sim}
        />
        <DeployAction
          planId={localPlanId}
          name={editedName}
          strategy={strategy}
          txCount={localPreview?.artifacts?.length ?? 0}
          preview={localPreview}
          onSimulated={(next) => {
            setLocalPreview(next);
            setLocalPlanId(next.planId);
          }}
        />
        <SaveStrategyAction name={editedName} strategy={strategy} preview={localPreview} />
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <ResultHeader name={editedName} onChange={setEditedName} onCancel={onCancel} />
        <MetricRow strategy={strategy} preview={localPreview} />
        <StepsPanel strategy={strategy} sim={sim} />
      </section>
    </div>
  );
}

export function DeployAction({
  planId,
  name,
  strategy,
  txCount,
  preview,
  onSimulated,
}: {
  planId?: string;
  name: string;
  strategy: Strategy;
  txCount: number;
  preview?: Preview;
  onSimulated: (preview: Preview) => void;
}) {
  const router = useRouter();
  const { address } = useAuth();
  const validatePlan = useValidatePlan();
  const executePlan = useExecutePlan();
  const sendPlanCalls = useSendPlanCalls();
  const simulateWithAmount = useSimulateWithAmount();

  const toast = useToastStore();

  const [step, setStep] = useState<"idle" | "simulating" | "validating" | "signing" | "confirming" | "deployed">("idle");
  const [txProgress, setTxProgress] = useState<{ current: number; total: number } | null>(null);
  const [txHashes, setTxHashes] = useState<string[]>([]);

  // Amount editing lives here (not a separate sibling component) specifically
  // so deploy can see it. It used to be split out into its own component with
  // its own local state, invisible to this one — editing the amount and
  // hitting "Approve & deploy" without first clicking "Simulate" deployed the
  // *original* plan's calldata, sized for the old amount, silently ignoring
  // whatever was typed. Keeping both in one place means deploy can always see
  // whether the box is dirty and settle it before building calldata.
  const input = preview?.input;
  const initialAmount = input
    ? input.amount === "0"
      ? "1"
      : formatUnits(BigInt(input.amount), input.decimals)
    : "";
  const [amountValue, setAmountValue] = useState(initialAmount);
  const amountDirty = amountValue.trim() !== "" && amountValue.trim() !== initialAmount;

  // Parses the amount box and re-simulates at that amount. Shared by the
  // manual "Simulate" button and by deploy's own auto-simulate-if-dirty step,
  // so there's exactly one place that turns the typed string into a plan.
  async function simulateAmount(): Promise<Preview | undefined> {
    if (!address || !input || !preview?.rawIntent) return undefined;
    let raw: bigint;
    try {
      raw = parseUnits(amountValue.trim(), input.decimals);
    } catch {
      toast.error("Enter a valid amount");
      return undefined;
    }
    if (raw <= BigInt(0)) {
      toast.error("Amount must be greater than zero");
      return undefined;
    }
    const next = await simulateWithAmount.mutateAsync({
      walletAddress: address,
      intent: preview.rawIntent,
      amount: raw.toString(),
    });
    onSimulated(next);
    if (!next.simulation.success) {
      toast.error("Simulation failed at this amount — check the details");
      return undefined;
    }
    return next;
  }

  async function handleManualSimulate() {
    const next = await simulateAmount().catch((e) => {
      toast.error(humanizeError(e, "Simulation failed"));
      return undefined;
    });
    if (next) toast.success(`Re-simulated for ${amountValue.trim()} ${input?.symbol}`);
  }

  async function handleDeploy() {
    if (!planId) return;
    try {
      // Amount was edited but never (re)simulated — settle it first instead
      // of deploying the stale plan underneath it.
      let activePlanId = planId;
      if (amountDirty) {
        setStep("simulating");
        const next = await simulateAmount();
        if (!next) {
          setStep("idle");
          return;
        }
        activePlanId = next.planId;
      }

      setStep("validating");
      await validatePlan.mutateAsync(activePlanId);

      const { artifacts } = await executePlan.mutateAsync(activePlanId);
      const signable = artifacts.filter(
        (a) => a.kind === "approval" || a.kind === "evmTx" || a.kind === "evmBundle",
      );

      setStep("signing");
      setTxProgress({ current: 0, total: signable.length });

      // EIP-5792 batch (single signature) with a legacy sequential fallback —
      // required for EIP-7702 smart-account wallets. See useSendPlanCalls.
      const hashes = await sendPlanCalls(
        signable.map((a) => ({
          to: a.tx.to,
          data: a.tx.data,
          value: a.tx.value,
          chainId: a.tx.chainId,
        })),
        {
          onProgress: (current, total) => {
            setStep(current >= total ? "confirming" : "signing");
            setTxProgress({ current, total });
          },
        },
      );

      // Batched sends can report the same hash for every included call —
      // dedupe so the success state doesn't repeat one link N times.
      setTxHashes(Array.from(new Set(hashes)));
      setStep("deployed");
      toast.success("Strategy deployed successfully");
    } catch (e) {
      console.error(e);
      toast.error(humanizeError(e, "Deployment failed"));
      setStep("idle");
      setTxProgress(null);
    }
  }

  const buttonLabel = () => {
    if (step === "idle") {
      return txCount > 0
        ? `Approve & deploy (${txCount} tx${txCount > 1 ? "s" : ""})`
        : "Approve & deploy";
    }
    if (step === "simulating") return "Simulating new amount…";
    if (step === "validating") return "Validating…";
    if (step === "signing") {
      return txProgress
        ? `Sign tx ${txProgress.current} of ${txProgress.total}…`
        : "Please sign…";
    }
    return "Confirming…";
  };

  if (step === "deployed") {
    return <DeploySuccessPanel txHashes={txHashes} onViewPortfolio={() => router.push("/portfolio?updated=1")} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {input && (
        <div className="flex flex-col gap-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] uppercase tracking-widest text-faint">Amount</span>
            <div className="flex items-center gap-2">
              <input
                value={amountValue}
                onChange={(e) => setAmountValue(e.target.value.replace(/[^0-9.]/g, ""))}
                disabled={step !== "idle"}
                inputMode="decimal"
                spellCheck={false}
                className="mono w-[110px] rounded-md border border-line bg-surface px-2 py-1.5 text-right text-[13px] font-semibold text-fg outline-none transition-colors focus:border-muted disabled:opacity-50"
              />
              <span className="text-[12px] font-medium text-muted">{input.symbol}</span>
            </div>
          </div>
          {amountDirty && (
            <button
              onClick={handleManualSimulate}
              disabled={step !== "idle"}
              className="h-9 rounded-lg border border-green/25 bg-green/10 text-[12.5px] font-semibold text-green-bright transition hover:bg-green/20 active:scale-[0.99] disabled:opacity-50"
            >
              {simulateWithAmount.isPending ? "Simulating…" : `Simulate with ${amountValue.trim()} ${input.symbol}`}
            </button>
          )}
        </div>
      )}
      {txCount > 0 && step === "idle" && (
        <div className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5 text-[12px] text-muted">
          <span className="font-medium text-fg-soft">{txCount} transaction{txCount > 1 ? "s" : ""}</span>
          {" "}will be submitted in sequence. Each requires a wallet signature.
        </div>
      )}
      {txProgress && step !== "idle" && (
        <div className="rounded-lg border border-line-soft bg-surface-2 px-3 py-2">
          <div className="mb-1.5 flex justify-between text-[11px]">
            <span className="text-muted">Progress</span>
            <span className="mono text-fg-soft">{txProgress.current}/{txProgress.total}</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-green transition-all duration-300"
              style={{ width: `${(txProgress.current / txProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      <WalletGate connectLabel="Connect wallet to deploy">
        <PrimaryButton
          onClick={handleDeploy}
          disabled={step !== "idle"}
        >
          {buttonLabel()}
        </PrimaryButton>
      </WalletGate>
    </div>
  );
}

// Extracted so it can be rendered standalone (dev preview route) without a
// real wallet/transaction — teammate feedback was on this exact view.
export function DeploySuccessPanel({
  txHashes,
  onViewPortfolio,
}: {
  txHashes: string[];
  onViewPortfolio: () => void;
}) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  function handleCopy(e: React.MouseEvent, hash: string) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash((h) => (h === hash ? null : h)), 1500);
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-line-soft bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-green/30 bg-green/10 text-green">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fg">Strategy deployed</div>
          <div className="text-[12px] text-muted">
            {txHashes.length} transaction{txHashes.length > 1 ? "s" : ""} confirmed on Base
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {txHashes.map((hash, i) => (
          <a
            key={hash}
            href={`https://basescan.org/tx/${hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-3 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5 transition hover:border-line hover:bg-elevated"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span className="mono flex h-5 w-5 flex-none items-center justify-center rounded-full bg-line text-[10px] text-faint">
                {i + 1}
              </span>
              <span className="mono truncate text-[12.5px] text-fg-soft">
                {hash.slice(0, 10)}…{hash.slice(-8)}
              </span>
            </span>
            <span className="flex flex-none items-center gap-1">
              <button
                onClick={(e) => handleCopy(e, hash)}
                title="Copy full hash"
                className="rounded p-1 text-faint opacity-0 transition group-hover:opacity-100 hover:bg-black/20 hover:text-fg-soft"
              >
                {copiedHash === hash ? (
                  <svg className="h-3.5 w-3.5 text-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
              <svg className="h-3.5 w-3.5 text-faint transition group-hover:text-fg-soft" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </span>
          </a>
        ))}
      </div>

      <PrimaryButton onClick={onViewPortfolio}>View in portfolio →</PrimaryButton>
    </div>
  );
}

// Explicit "save for later" — persists to the real backend (/fortress/saved-strategies).
//
// TEMPORARY PLACEMENT: the real flow saves *after* the user approves and
// runs the transaction (i.e. from a success state post-deploy), not here on
// the pre-deploy result screen. It's wired in here for now purely so it's
// easy to reach and test without needing a full deploy each time — move it
// into the post-deploy success state once that's built.
export function SaveStrategyAction({
  name,
  strategy,
  preview,
}: {
  name: string;
  strategy: Strategy;
  preview?: Preview;
}) {
  const { address, status } = useAuth();
  const toast = useToastStore();
  const { data } = useSavedStrategies(address);
  const saveStrategy = useSaveStrategy();
  const mine = data?.items ?? [];
  const atLimit = mine.length >= MAX_SAVED_STRATEGIES;

  function handleSave() {
    if (!address || !preview) return;
    saveStrategy.mutate(
      {
        walletAddress: address,
        name: name || strategy.name || "Untitled strategy",
        prompt: strategy.prompt,
        preview,
      },
      {
        onSuccess: () => toast.success("Strategy saved"),
        onError: (err) => {
          if (err instanceof FortressApiError && err.status === 409) {
            toast.error(`You've saved ${MAX_SAVED_STRATEGIES} strategies already — delete one to save more`);
          } else {
            toast.error("Failed to save strategy");
          }
        },
      },
    );
  }

  if (status !== "authenticated") return null;

  return (
    <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5">
      <span className="text-[11.5px] text-faint">
        {mine.length}/{MAX_SAVED_STRATEGIES} saved
      </span>
      <button
        onClick={handleSave}
        disabled={atLimit || !preview || saveStrategy.isPending}
        className="text-[12.5px] font-medium text-fg-soft transition-colors hover:text-fg disabled:cursor-not-allowed disabled:text-faint disabled:hover:text-faint"
      >
        {atLimit ? "Save limit reached" : saveStrategy.isPending ? "Saving…" : "Save for later"}
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-medium text-muted">{children}</div>;
}

function PromptSummary({ 
  strategy, 
  prompt, 
  onChange, 
  onRegenerate,
  hasChanges
}: { 
  strategy: Strategy;
  prompt: string;
  onChange: (val: string) => void;
  onRegenerate: () => void;
  hasChanges: boolean;
}) {
  return (
    <div className="rounded-xl border border-line-soft bg-surface p-4">
      <FieldLabel>Starting token</FieldLabel>
      <div className="mb-3.5 flex items-center gap-2.5">
        <TokenIcon symbol={strategy.startingToken} size={22} />
        <span className="text-[14px] font-medium">{strategy.startingToken}</span>
      </div>
      <FieldLabel>Prompt</FieldLabel>
      <div className="mb-3">
        <PromptComposer value={prompt} onChange={onChange} />
      </div>
      {hasChanges && (
        <button 
          onClick={onRegenerate}
          className="h-9 w-full rounded-lg bg-fg text-[13px] font-semibold text-ink transition active:scale-[0.99]"
        >
          Regenerate Strategy
        </button>
      )}
    </div>
  );
}

// The backend tacks "(step N/M)" onto the end of the plain-English reason —
// pull that out so it renders as its own small tag instead of running on as
// part of the sentence, which read as a raw backend-string dump.
function splitStepSuffix(reason: string): { message: string; step?: string } {
  const match = reason.match(/^(.*?)\s*\(step (\d+\/\d+)\)\s*$/);
  return match ? { message: match[1].trim(), step: match[2] } : { message: reason };
}

// Compact failure banner for the result screen's step list — the full
// SimulationPanel below covers the aside, but nothing currently renders it,
// so a passing-or-failing simulation looked identical there was no visible
// difference. This surfaces the same revertReason inline wherever a
// strategy's steps render (fresh generate or a re-simulated amount), instead
// of only a toast that disappears.
export function SimulationBanner({ preview }: { preview?: Preview }) {
  if (!preview?.simulation || preview.simulation.success) return null;
  const revertReason = preview.simulation.revertReason;
  const { message, step } = revertReason ? splitStepSuffix(revertReason) : {};
  return (
    <div className="mb-3.5 flex items-start gap-3 rounded-xl border border-line-soft bg-surface p-3.5">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-red/30 bg-red/10 text-red">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">Simulation failed</span>
          {step && (
            <span className="mono flex-none rounded-full bg-line px-1.5 py-0.5 text-[10px] text-faint">
              step {step}
            </span>
          )}
        </div>
        {message && (
          <div className="mt-1 break-words text-[12px] leading-relaxed text-muted">{message}</div>
        )}
      </div>
    </div>
  );
}

function SimulationPanel({
  strategy,
  preview,
  sim,
}: {
  strategy: Strategy;
  preview?: import("@fortress/core").Preview;
  sim: import("./useSimulation").Simulation;
}) {
  const passed = preview?.simulation?.success ?? false;
  const gasUsed = preview?.simulation?.gasUsed ?? null;
  const revertReason = preview?.simulation?.revertReason ?? null;
  const apy = preview?.apy;
  // deposit/swapAndDeposit intents have no `apy` block (that's leverage/strategy
  // only) — their per-protocol APY lives in `allocations.legs` + top-level `netApy`.
  const allocations = preview?.allocations;
  const netApy = preview?.netApy;

  // Format raw gas units into a readable number with commas.
  const gasLabel = gasUsed
    ? Number(gasUsed).toLocaleString() + " gas"
    : null;

  return (
    <div className="flex flex-col rounded-xl border border-line-soft bg-surface p-4">
      <h3 className="mb-3 text-[12.5px] font-semibold">Simulation</h3>

      {/* Status badge */}
      <div className="mb-3 flex items-center gap-2.5 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5 text-[13px]">
        <span
          className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border ${
            passed ? "border-green/30 bg-green/10 text-green" : "border-red/30 bg-red/10 text-red"
          }`}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            {passed ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            )}
          </svg>
        </span>
        <span className="font-medium text-fg-soft">{passed ? "Simulation passed" : "Simulation failed"}</span>
      </div>

      {/* Gas used */}
      {gasLabel && (
        <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5 text-[12.5px]">
          <span className="text-muted">Gas used</span>
          <span className="mono font-medium text-fg-soft">{gasLabel}</span>
        </div>
      )}

      {/* Revert reason if failed */}
      {!passed && revertReason && (() => {
        const { message, step } = splitStepSuffix(revertReason);
        return (
          <div className="mt-2 rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12px] text-muted">
            {step && (
              <span className="mono mr-1.5 rounded-full bg-line px-1.5 py-0.5 text-[10px] text-faint">
                step {step}
              </span>
            )}
            <span className="break-words">{message}</span>
          </div>
        );
      })()}

      {/* APY breakdown from the API apy block */}
      {apy && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="mb-0.5 text-[11px] font-medium text-muted">APY breakdown</div>

          {apy.collateralApy && apy.collateralApy.value != null && (
            <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="text-muted">
                Collateral
                {apy.collateralApy.source ? (
                  <span className="ml-1 text-[11px] text-faint">({apy.collateralApy.source})</span>
                ) : null}
              </span>
              <span className="mono font-medium text-green">
                +{(apy.collateralApy.value * 100).toFixed(2)}%
              </span>
            </div>
          )}

          {apy.borrowApy && apy.borrowApy.value != null && (
            <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="text-muted">
                Borrow
                {apy.borrowApy.source ? (
                  <span className="ml-1 text-[11px] text-faint">({apy.borrowApy.source})</span>
                ) : null}
              </span>
              <span className="mono font-medium text-amber">
                −{(apy.borrowApy.value * 100).toFixed(2)}%
              </span>
            </div>
          )}

          {apy.netApy && apy.netApy.value != null && (
            <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="font-medium text-fg-soft">Net APY</span>
              <span
                className={`mono font-semibold ${
                  apy.netApy.value >= 0 ? "text-green" : "text-red"
                }`}
              >
                {apy.netApy.value >= 0 ? "+" : ""}
                {(apy.netApy.value * 100).toFixed(2)}%
              </span>
            </div>
          )}

          {typeof apy.leverage === "number" && (
            <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="text-muted">Leverage</span>
              <span className="mono font-medium text-fg-soft">
                {apy.leverage.toFixed(2)}×
              </span>
            </div>
          )}
        </div>
      )}

      {/* Deposit/swapAndDeposit intents: per-protocol APY from allocations.legs
          instead of the leverage-only `apy` block above. */}
      {!apy && allocations && allocations.legs.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="mb-0.5 text-[11px] font-medium text-muted">APY breakdown</div>

          {allocations.legs.map((leg, i) => (
            <div key={`${leg.protocol}-${i}`} className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 text-muted">
                {leg.protocol}
                {leg.market && <VaultBadge label={leg.market} address={leg.marketAddress} />}
                {leg.bps < 10000 && (
                  <span className="text-[11px] text-faint">({(leg.bps / 100).toFixed(0)}%)</span>
                )}
              </span>
              {leg.apy != null ? (
                <span className="mono font-medium text-green">+{(leg.apy * 100).toFixed(2)}%</span>
              ) : (
                <span className="mono text-[11px] text-faint">unavailable</span>
              )}
            </div>
          ))}

          {netApy != null && allocations.legs.length > 1 && (
            <div className="flex items-center justify-between rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[12.5px]">
              <span className="font-medium text-fg-soft">Net APY</span>
              <span className={`mono font-semibold ${netApy >= 0 ? "text-green" : "text-red"}`}>
                {netApy >= 0 ? "+" : ""}
                {(netApy * 100).toFixed(2)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Inline step animation driven by the sim hook (used during flowchart walk) */}
      {sim.phase === "running" && (
        <div className="mt-3 flex items-center gap-2 text-[11.5px] text-muted">
          <span
            className="h-3 w-3 rounded-full border-2 border-line"
            style={{ borderTopColor: "#888", animation: "fspin .7s linear infinite" }}
          />
          Walking steps…
        </div>
      )}
    </div>
  );
}


function ResultRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      {children}
    </div>
  );
}

function ResultHeader({ 
  name, 
  onChange,
  onCancel 
}: { 
  name: string; 
  onChange: (val: string) => void;
  onCancel?: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="mb-3.5 flex items-start justify-between">
      <div className="flex items-center gap-2.5">
        {isEditing ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
            className="h-8 rounded-md border border-line bg-surface px-2 text-[18px] font-bold tracking-tight text-fg outline-none"
          />
        ) : (
          <>
            <h2 className="text-[18px] font-bold tracking-tight">{name || "Untitled strategy"}</h2>
            <span 
              onClick={() => setIsEditing(true)}
              className="cursor-pointer text-[13px] text-faint hover:text-fg-soft"
            >
              ✎
            </span>
          </>
        )}
        {!isEditing && <span className="mono text-[11.5px] text-faint">· 27s ago</span>}
      </div>
      <button
        onClick={onCancel}
        className="h-8 rounded border border-white/10 bg-[#161619] px-3 text-[11px] font-medium text-white/40 transition hover:text-white hover:bg-white/5"
      >
        Cancel
      </button>
    </div>
  );
}

export function MetricRow({ strategy }: { strategy: Strategy; preview?: import("@fortress/core").Preview }) {
  const leverage = strategy.leverage;
  const hasLeverage = typeof leverage === "number" && leverage > 1.001;

  return (
    <div className="mb-3 flex flex-col gap-2 sm:flex-row">
      {/* Net APY — the headline number, with the leverage math a hover away. */}
      <div className="flex flex-none flex-col justify-center rounded-xl bg-line-soft px-5 py-3.5 sm:min-w-[168px]">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-faint">
          <span>Net APY</span>
          {strategy.netApy < 0 && (
            <svg className="h-3 w-3 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          )}
          {hasLeverage && (
            <span className="group/apy relative inline-flex">
              <span className="mono flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-line text-[8px] font-bold normal-case text-muted transition-colors hover:border-muted hover:text-fg-soft">
                i
              </span>
              <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-[260px] -translate-x-1/2 rounded-lg border border-line bg-elevated px-3 py-2.5 text-[11px] normal-case leading-relaxed text-fg-soft opacity-0 shadow-xl transition-opacity duration-150 group-hover/apy:opacity-100">
                <div className="mono mb-1 text-[10px] text-muted">netApy = (collateral·apy − debt·borrow) / equity</div>
                <div className="mono mb-1.5 text-[10px] text-muted">equity = collateral + idle − debt</div>
                With {leverage.toFixed(2)}× leverage, you earn yield on the full collateral position but only pay borrow cost on what&apos;s actually borrowed.
              </span>
            </span>
          )}
        </div>
        <div className={`mono text-[24px] font-semibold leading-none ${strategy.netApy >= 0 ? "text-green-bright" : "text-red"}`}>
          {strategy.netApy.toFixed(2)}%
        </div>
        {hasLeverage && (
          <div className="mono mt-1.5 text-[10.5px] text-muted">{leverage.toFixed(2)}× leverage</div>
        )}
      </div>

      {/* Breakdown — each APY leg as a readable chip instead of squeezed rows. */}
      {strategy.legs.length > 0 && (
        <div className="flex flex-1 flex-col justify-center rounded-xl bg-line-soft px-4 py-3.5">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Breakdown</div>
          <div className="flex flex-wrap gap-1.5">
            {strategy.legs.map((leg) => {
              const apy = formatApy(leg.value, leg.kind);
              return (
                <div
                  key={leg.label}
                  className="flex items-center gap-1.5 rounded-lg border border-line/40 bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span className="text-[10.5px] text-muted">{leg.label}</span>
                  <span className={`mono text-[11px] ${apy.negative ? "text-red-soft" : "text-green"}`}>
                    {apy.text}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={`flex flex-col justify-center rounded-xl bg-line-soft px-5 py-3.5 ${strategy.legs.length > 0 ? "flex-none sm:min-w-[150px]" : "flex-1"}`}>
        {strategy.allocations ? (
          <>
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Protocols</div>
            <div className="mono text-[24px] font-semibold leading-none text-fg">{strategy.allocations.legs.length}</div>
            <div className="mt-1.5 text-[10.5px] text-faint">{strategy.chain}</div>
          </>
        ) : (
          <>
            <div className="mb-1.5 text-[10px] uppercase tracking-widest text-faint">Steps</div>
            <div className="mono text-[24px] font-semibold leading-none text-fg">{countVisualSteps(strategy.steps)}</div>
            <div className="mt-1.5 text-[10.5px] text-faint">
              {strategy.protocolsUsed} protocols · {strategy.chain}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function StepsPanel({ strategy, sim }: { strategy: Strategy; sim: Simulation }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-surface-2/40 backdrop-blur-xl border border-line/30 shadow-2xl">
      <div className="flex flex-none items-center gap-2 border-b border-line/40 px-5 py-4">
        <NetworkIcon network={strategy.chain} size={17} />
        <span className="text-[12.5px] font-semibold">{strategy.chain}</span>
        <span className="mono text-[11.5px] text-faint">· {countVisualSteps(strategy.steps)} Actions</span>
      </div>

      <div className="fx-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <StepList strategy={strategy} sim={sim} />
      </div>
    </div>
  );
}
