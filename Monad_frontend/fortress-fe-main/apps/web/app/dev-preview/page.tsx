"use client";

// TEMPORARY design-review route — not linked from anywhere in the app.
// Renders components with mock data so they can be reviewed/iterated on
// without a real wallet + transaction. Delete once the design is settled.

import { DeploySuccessPanel, SimulationBanner } from "@/components/strategy/StrategyResult";
import { Toaster } from "@/components/ui/Toast";
import { useToastStore } from "@/store/toast";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import type { Preview } from "@fortress/core";

const MOCK_HASHES = [
  "0x7a3f9c2e8b1d4a6f0c5e9b2d7a4f1c8e3b6d9a2f5c8e1b4d7a0f3c6e9b2d5a8f",
  "0x1c4f7a0d3e6b9c2f5a8d1e4b7c0f3a6d9e2b5c8f1a4d7e0b3c6f9a2d5e8b1c4f",
];

const MOCK_FAILED_PREVIEW: Preview = {
  planId: "mock-plan-1",
  humanSummary: "mock",
  simulation: {
    success: false,
    revertReason: "Insufficient token balance — the wallet does not hold enough to execute this transaction. (step 3/3)",
    gasUsed: "116376",
    gasCostNative: "0",
    balanceChanges: [],
    rawLogs: [],
  },
  artifacts: [],
  previewCards: [],
};

export default function DevPreviewPage() {
  const toast = useToastStore();

  return (
    <div className="min-h-dvh bg-[#0a0a0c] p-10">
      <Toaster />
      <div className="mx-auto flex max-w-[900px] flex-wrap gap-8">
        <div className="flex w-[384px] flex-none flex-col gap-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-fg-soft">DeploySuccessPanel — 2 tx hashes</h2>
          <DeploySuccessPanel txHashes={MOCK_HASHES} onViewPortfolio={() => alert("would navigate to /portfolio")} />
        </div>
        <div className="flex w-[384px] flex-none flex-col gap-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-fg-soft">DeploySuccessPanel — 1 tx hash (batched)</h2>
          <DeploySuccessPanel txHashes={[MOCK_HASHES[0]]} onViewPortfolio={() => alert("would navigate to /portfolio")} />
        </div>
        <div className="flex w-[384px] flex-none flex-col gap-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-fg-soft">SimulationBanner — failed w/ step badge</h2>
          <SimulationBanner preview={MOCK_FAILED_PREVIEW} />
        </div>
        <div className="flex w-[384px] flex-none flex-col gap-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-fg-soft">Toaster — click to trigger (live, via the store)</h2>
          <div className="flex flex-col gap-2">
            <PrimaryButton onClick={() => toast.success("Strategy deployed successfully")}>
              Trigger success toast
            </PrimaryButton>
            <PrimaryButton onClick={() => toast.error("Transaction cancelled.")}>
              Trigger error toast
            </PrimaryButton>
            <PrimaryButton onClick={() => toast.info("Re-simulated for 5 USDC")}>
              Trigger info toast
            </PrimaryButton>
          </div>
        </div>
        <div className="flex w-[384px] flex-none flex-col gap-3.5">
          <h2 className="mb-1 text-[13px] font-semibold text-fg-soft">Toast — static (guaranteed visible, same markup)</h2>
          <div className="flex flex-col gap-2.5">
            {(["success", "error", "info"] as const).map((type) => (
              <div
                key={type}
                className="flex w-80 items-start gap-3 rounded-xl border border-line-soft bg-surface p-3.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]"
              >
                <span
                  className={`flex h-8 w-8 flex-none items-center justify-center rounded-full border ${
                    type === "success"
                      ? "border-green/30 bg-green/10 text-green"
                      : type === "error"
                        ? "border-red/30 bg-red/10 text-red"
                        : "border-line bg-surface-2 text-muted"
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={type === "info" ? 2 : 2.5}>
                    {type === "success" && <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />}
                    {type === "error" && <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />}
                    {type === "info" && <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />}
                  </svg>
                </span>
                <div className="flex-1 pt-1 text-[13px] font-medium leading-snug text-fg-soft">
                  {type === "success" && "Strategy deployed successfully"}
                  {type === "error" && "Transaction cancelled."}
                  {type === "info" && "Re-simulated for 5 USDC"}
                </div>
                <button className="flex-none rounded-md p-1 text-faint transition hover:bg-elevated hover:text-fg-soft">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
