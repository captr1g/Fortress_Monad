"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { TopBar } from "@/components/strategy/TopBar";
import { useAuth } from "@/components/auth/AuthProvider";
import { PortfolioContent } from "@/components/portfolio/Portfolio";
import { SavedContent } from "@/components/strategy/SavedStrategies";
import { IdenticonAvatar } from "./IdenticonAvatar";
import { PHASE_TRANSITION } from "@/lib/motion";

type Tab = "portfolio" | "saved";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "saved", label: "Saved" },
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, address, signIn } = useAuth();

  const paramTab = searchParams.get("tab") === "saved" ? "saved" : "portfolio";
  const [tab, setTab] = useState<Tab>(paramTab);
  const [prevParamTab, setPrevParamTab] = useState(paramTab);

  if (paramTab !== prevParamTab) {
    setPrevParamTab(paramTab);
    setTab(paramTab);
  }

  function switchTab(next: Tab) {
    setTab(next);
    router.replace(next === "saved" ? "/profile?tab=saved" : "/profile", { scroll: false });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar />

      <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {status !== "authenticated" ? (
          <ConnectGate onConnect={() => signIn()} />
        ) : (
          <>
            <IdentityHeader address={address} />

            <TabBar tab={tab} onSwitch={switchTab} />

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={PHASE_TRANSITION}
              >
                {tab === "portfolio" ? <PortfolioContent /> : <SavedContent />}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </main>
    </div>
  );
}

function IdentityHeader({ address }: { address?: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mb-6 flex items-center gap-4">
      {address ? (
        <IdenticonAvatar address={address} size={56} />
      ) : (
        <div aria-hidden className="h-14 w-14 flex-none rounded-full border border-line bg-surface" />
      )}
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold tracking-tight sm:text-[22px]">Profile</h1>
        {address && (
          <button
            onClick={handleCopy}
            className="group mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-fg-soft"
            title="Copy address"
          >
            <span className="mono">{shortAddress(address)}</span>
            {copied ? (
              <svg className="h-3.5 w-3.5 text-green-bright" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5 text-faint transition-colors group-hover:text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function TabBar({ tab, onSwitch }: { tab: Tab; onSwitch: (t: Tab) => void }) {
  return (
    <div className="mb-6 flex items-center gap-6 border-b border-line-soft">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            onClick={() => onSwitch(t.id)}
            className={`relative pb-3 text-[13.5px] font-medium transition-colors ${
              active ? "text-fg" : "text-muted hover:text-fg-soft"
            }`}
          >
            {t.label}
            {active && (
              <motion.div
                layoutId="profile-tab-underline"
                className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-fg"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ConnectGate({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="flex h-[420px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-line-soft bg-surface-2">
        <svg className="h-7 w-7 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18-3a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6" />
        </svg>
      </div>
      <div className="mb-1.5 text-[16px] font-semibold text-fg">Connect your wallet</div>
      <p className="mb-6 max-w-[300px] text-[13px] text-muted">
        Connect your wallet to see your portfolio and saved strategies.
      </p>
      <button
        onClick={onConnect}
        className="h-10 rounded-lg bg-fg px-6 text-[13.5px] font-semibold text-ink transition active:scale-[0.99] hover:opacity-90"
      >
        Connect wallet
      </button>
    </div>
  );
}
