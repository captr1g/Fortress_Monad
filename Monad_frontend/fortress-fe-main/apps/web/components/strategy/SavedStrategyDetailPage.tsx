"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { TokenIcon } from "./icons";
import { MetricRow, StepsPanel } from "./StrategyResult";
import { useSimulation } from "./useSimulation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToastStore } from "@/store/toast";
import {
  useSavedStrategies,
  useDeleteSavedStrategy,
  useRenameSavedStrategy,
  useTouchSavedStrategyUsage,
} from "@fortress/core/hooks";
import { previewToStrategy } from "@/lib/mapPreview";
import { strategySummary } from "@/lib/strategy";
import { PANEL_TRANSITION } from "@/lib/motion";
import { relativeDate } from "./SavedStrategies";

function ActivityRow({ label, iso }: { label: string; iso: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-muted">{label}</span>
      <span className="mono text-faint">{relativeDate(iso)}</span>
    </div>
  );
}

// A full page, not a modal — a saved strategy carries the same amount of
// content (prompt, metrics, every step) as the live result screen, so it
// gets the same amount of room instead of being squeezed into a popup.
export function SavedStrategyDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToastStore();
  const { address, status } = useAuth();
  const { data } = useSavedStrategies(address);
  const deleteSaved = useDeleteSavedStrategy();
  const renameSaved = useRenameSavedStrategy();
  const touchUsage = useTouchSavedStrategyUsage();
  const item = data?.items.find((i) => i.id === id);
  const strategy = item ? previewToStrategy(item.preview, { prompt: item.prompt, name: item.name }) : undefined;
  const summary = strategy ? strategySummary(strategy) : undefined;

  const sim = useSimulation(strategy?.steps.length ?? 0);

  // Editable title — seeded from the persisted name, reset whenever a
  // different saved strategy loads (id changes without a full remount).
  const [nameDraft, setNameDraft] = useState(strategy?.name ?? "");
  const [prevId, setPrevId] = useState(id);
  const [prevStrategyName, setPrevStrategyName] = useState(strategy?.name ?? "");

  if (id !== prevId || strategy?.name !== prevStrategyName) {
    setPrevId(id);
    setPrevStrategyName(strategy?.name ?? "");
    setNameDraft(strategy?.name ?? "");
  }

  function commitName() {
    if (!item) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === item.name) {
      setNameDraft(item.name);
      return;
    }
    renameSaved.mutate(
      { id: item.id, walletAddress: item.wallet, name: trimmed },
      { onError: () => { toast.error("Failed to rename"); setNameDraft(item.name); } },
    );
  }

  function handleRegenerate() {
    if (!strategy || !item) return;
    if (address) touchUsage.mutate({ id: item.id, walletAddress: address });
    router.push(`/prompt?prompt=${encodeURIComponent(strategy.prompt)}`);
  }

  function handleDelete() {
    if (!item) return;
    deleteSaved.mutate(
      { id: item.id, walletAddress: item.wallet },
      {
        onSuccess: () => {
          toast.info("Removed from saved");
          router.push("/profile?tab=saved");
        },
        onError: () => toast.error("Failed to remove"),
      },
    );
  }

  if (status !== "authenticated" || !item || !strategy) {
    return (
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <div className="text-[15px] font-semibold text-fg-soft">
            {status !== "authenticated" ? "Connect your wallet to view saved strategies." : "Strategy not found."}
          </div>
          <button
            onClick={() => router.push("/profile?tab=saved")}
            className="text-[13px] font-medium text-muted transition-colors hover:text-fg"
          >
            ← Back to saved
          </button>
        </main>
      </div>
    );
  }

  const hasLeverage = typeof strategy.leverage === "number" && strategy.leverage > 1.001;

  return (
    <div className="flex h-dvh flex-col">
      <TopBar />
      <main className="mx-auto flex w-full max-w-[1320px] flex-1 flex-col gap-5 overflow-y-auto p-4 md:flex-row md:overflow-hidden md:p-[22px]">
        <motion.aside
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={PANEL_TRANSITION}
          className="flex w-full flex-none flex-col gap-3.5 md:w-[384px]"
        >
          <button
            onClick={() => router.push("/profile?tab=saved")}
            className="mb-1 flex items-center gap-1.5 self-start text-[13px] font-medium text-muted transition-colors hover:text-fg-soft"
          >
            <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Saved
          </button>

          <div className="rounded-xl border border-line-soft bg-surface-2 p-4">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Prompt</div>
            <div className="text-[14.5px] font-medium leading-relaxed text-fg">{strategy.prompt}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg border border-line-soft bg-surface px-2.5 py-1.5 text-[11px] text-muted">
              <TokenIcon symbol={strategy.startingToken} size={14} />
              {strategy.startingToken} on {strategy.chain}
            </span>
            {hasLeverage && (
              <span className="mono rounded-lg border border-line-soft bg-surface px-2.5 py-1.5 text-[11px] text-muted">
                {strategy.leverage!.toFixed(2)}× leverage
              </span>
            )}
            {summary?.startingAmount && (
              <span className="mono rounded-lg border border-line-soft bg-surface px-2.5 py-1.5 text-[11px] text-muted">
                {summary.startingAmount} {summary.startingToken} starting
              </span>
            )}
          </div>

          <div className="rounded-xl border border-line-soft bg-surface-2 p-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-faint">Activity</div>
            <div className="flex flex-col gap-1.5">
              <ActivityRow label="Saved" iso={item.savedAt} />
              {item.renamedAt && <ActivityRow label="Renamed" iso={item.renamedAt} />}
              {item.lastUsedAt && <ActivityRow label="Last used" iso={item.lastUsedAt} />}
            </div>
          </div>

          <div className="mt-auto flex flex-col gap-2.5">
            <div>
              <button
                onClick={handleRegenerate}
                className="h-11 w-full rounded-lg bg-fg text-[14px] font-semibold text-ink transition active:scale-[0.99] hover:opacity-90"
              >
                Edit & Regenerate
              </button>
              <p className="mt-1.5 text-center text-[11px] leading-relaxed text-faint">
                Reruns with current market rates — yours may have changed since you saved this.
              </p>
            </div>
            <button
              onClick={handleDelete}
              disabled={deleteSaved.isPending}
              className="h-10 rounded-lg border border-line bg-surface-2 text-[13px] font-semibold text-red/80 transition hover:bg-red/10 hover:text-red disabled:opacity-50"
            >
              {deleteSaved.isPending ? "Removing…" : "Delete"}
            </button>
          </div>
        </motion.aside>

        <motion.section
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={PANEL_TRANSITION}
          className="flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="mb-3.5">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setNameDraft(strategy.name);
              }}
              spellCheck={false}
              placeholder="Name this strategy…"
              className="w-full rounded-md border border-transparent bg-transparent px-1 -mx-1 text-[18px] font-bold tracking-tight text-fg outline-none transition-colors placeholder:text-faint hover:border-line-soft focus:border-line focus:bg-surface-2"
            />
            <div className="mt-0.5 px-1 text-[11.5px] text-faint">
              Saved strategy · {strategy.chain} · not deployed yet
              {renameSaved.isPending && <span className="ml-1.5">· saving…</span>}
            </div>
          </div>
          <MetricRow strategy={strategy} />
          <StepsPanel strategy={strategy} sim={sim} />
        </motion.section>
      </main>
    </div>
  );
}
