"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { TokenIcon } from "./icons";
import { useAuth } from "@/components/auth/AuthProvider";
import { useToastStore } from "@/store/toast";
import {
  useSavedStrategies,
  useDeleteSavedStrategy,
  useTouchSavedStrategyUsage,
  MAX_SAVED_STRATEGIES,
} from "@fortress/core/hooks";
import type { SavedStrategy } from "@fortress/core";
import { previewToStrategy } from "@/lib/mapPreview";
import { strategySummary } from "@/lib/strategy";
import { riseIn } from "@/lib/motion";

// Saved-strategies content for /profile's Saved tab. The page shell (TopBar,
// header, auth gate) lives in ProfilePage — this assumes an authenticated wallet.
export function SavedContent() {
  const { address } = useAuth();
  const { data, isLoading } = useSavedStrategies(address);
  const items = data?.items ?? [];

  if (isLoading) return <SavedSkeleton />;
  if (items.length === 0) return <EmptySaved />;

  return (
    <div>
      <p className="mb-4 text-[12.5px] text-faint">
        Up to {MAX_SAVED_STRATEGIES} strategies saved for later, before deploying.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <motion.div key={item.id} {...riseIn(i)}>
            <SavedCard item={item} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function SavedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[170px] animate-pulse rounded-2xl border border-line-soft bg-surface" />
      ))}
    </div>
  );
}

function EmptySaved() {
  const router = useRouter();
  return (
    <div className="flex h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-center">
      <div className="mb-1.5 text-[16px] font-semibold text-fg">Nothing saved yet</div>
      <p className="mb-6 max-w-[300px] text-[13px] text-muted">
        Generate a strategy and hit &quot;Save for later&quot; to keep it here without deploying.
      </p>
      <button
        onClick={() => router.push("/prompt")}
        className="h-10 rounded-lg bg-fg px-6 text-[13.5px] font-semibold text-ink transition active:scale-[0.99] hover:opacity-90"
      >
        Build a strategy
      </button>
    </div>
  );
}

export function relativeDate(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Small overlapping icon stack for the (usually 2-4) distinct tokens a
// strategy touches — reads faster than a wall of symbol text.
function TokenStack({ tokens }: { tokens: string[] }) {
  const shown = tokens.slice(0, 3);
  const overflow = tokens.length - shown.length;
  return (
    <div className="flex flex-none items-center">
      {shown.map((t, i) => (
        <div key={t} className={i > 0 ? "-ml-2" : ""} style={{ zIndex: shown.length - i }}>
          <TokenIcon symbol={t} size={30} />
        </div>
      ))}
      {overflow > 0 && (
        <div
          className="-ml-2 flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-soft bg-surface-2 text-[10px] font-semibold text-muted"
          style={{ zIndex: 0 }}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}

function SavedCard({ item }: { item: SavedStrategy }) {
  const router = useRouter();
  const toast = useToastStore();
  const { address } = useAuth();
  const deleteSaved = useDeleteSavedStrategy();
  const touchUsage = useTouchSavedStrategyUsage();
  const strategy = previewToStrategy(item.preview, { prompt: item.prompt, name: item.name });
  const summary = strategySummary(strategy);
  const hasLeverage = typeof summary.leverage === "number" && summary.leverage > 1.001;
  const lastUsedLabel = item.lastUsedAt
    ? `Last used ${relativeDate(item.lastUsedAt)}`
    : `Saved ${relativeDate(item.savedAt)}`;

  function handleOpen() {
    router.push(`/saved/${item.id}`);
  }

  function handleRegenerate(e: React.MouseEvent) {
    e.stopPropagation();
    if (address) touchUsage.mutate({ id: item.id, walletAddress: address });
    router.push(`/prompt?prompt=${encodeURIComponent(strategy.prompt)}`);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    deleteSaved.mutate(
      { id: item.id, walletAddress: item.wallet },
      { onSuccess: () => toast.info("Removed from saved"), onError: () => toast.error("Failed to remove") },
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && handleOpen()}
      className="group flex h-full cursor-pointer flex-col rounded-2xl border border-line-soft bg-surface p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-line"
    >
      <div className="flex items-start gap-3">
        <TokenStack tokens={summary.tokens} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-fg">{strategy.name}</div>
          <div className="mt-1">
            <span className="rounded-md border border-line-soft bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-faint">
              {summary.chain}
            </span>
          </div>
        </div>
        <button
          onClick={handleDelete}
          aria-label="Delete saved strategy"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-faint opacity-0 transition-all hover:bg-red/10 hover:text-red group-hover:opacity-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="mb-4 mt-4 flex items-center gap-4">
        <div>
          <div className="mb-1 text-[9.5px] uppercase tracking-widest text-faint">Net APY</div>
          <div className={`mono text-[17px] font-semibold leading-none ${summary.netApy < 0 ? "text-amber" : "text-green-bright"}`}>
            {summary.netApy >= 0 ? "+" : ""}
            {summary.netApy.toFixed(2)}%
          </div>
        </div>
        {summary.startingAmount && (
          <div>
            <div className="mb-1 text-[9.5px] uppercase tracking-widest text-faint">Starting</div>
            <div className="mono text-[13px] font-medium leading-none text-fg-soft">
              {summary.startingAmount} {summary.startingToken}
            </div>
          </div>
        )}
        {hasLeverage && (
          <div>
            <div className="mb-1 text-[9.5px] uppercase tracking-widest text-faint">Leverage</div>
            <div className="mono text-[13px] font-medium leading-none text-fg-soft">{summary.leverage!.toFixed(2)}×</div>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-line-soft pt-3">
        <span className="text-[11px] text-faint">{lastUsedLabel}</span>
        <span onClick={handleRegenerate} className="text-[12px] font-medium text-fg-soft transition-colors hover:text-fg">
          Edit & Regenerate →
        </span>
      </div>
    </div>
  );
}
