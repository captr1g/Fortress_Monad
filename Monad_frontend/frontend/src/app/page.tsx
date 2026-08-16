"use client";

import { useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { ChatInput } from "@/components/ChatInput";
import { PipelineStages } from "@/components/PipelineStages";
import { PreviewCard } from "@/components/PreviewCard";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { RawDataViewer } from "@/components/RawDataViewer";
import { WalletConnect } from "@/components/WalletConnect";
import { AuthGate } from "@/components/AuthGate";
import { PositionsPanel } from "@/components/PositionsPanel";
import { StrategiesPanel } from "@/components/StrategiesPanel";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { useAuth } from "@/hooks/useAuth";
import { useSignTransactions } from "@/hooks/useSignTransactions";
import { planPrompt, refreshPositions, resimulate } from "@/lib/api";
import type { FortressPlan, ApiError } from "@/lib/api";

// Actions that open or modify a Morpho Blue position; after signing, force a
// positions re-discovery so the new position surfaces without waiting for reconnect.
const POSITION_ACTIONS = new Set(["leverage", "strategy"]);
import type { PhaseState } from "@/lib/types";
import { initialPhases, runningPhases, successPhases, errorPhases } from "@/lib/types";

const DEMO_WALLET = "0x0000000000000000000000000000000000000001";

type HistoryEntry = {
  id: string;
  prompt: string;
  phases: PhaseState[];
  plan: FortressPlan | null;
  error: ApiError | null;
  raw: unknown;
  timestamp: number;
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const sign = useSignTransactions();
  const { isAuthenticated, walletAddress: authWallet, logout } = useAuth();

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activePhases, setActivePhases] = useState<PhaseState[]>(initialPhases());
  const [confirming, setConfirming] = useState(false);

  const walletAddress = isConnected && address ? address : DEMO_WALLET;

  const addEntry = useCallback((entry: HistoryEntry) => {
    setHistory((h) => [entry, ...h]);
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string) => {
      setLoading(true);
      setActivePhases(runningPhases(0));
      const id = crypto.randomUUID();

      try {
        setActivePhases(runningPhases(1));
        const plan = await planPrompt(prompt, walletAddress);
        setActivePhases(successPhases());

        addEntry({
          id,
          prompt,
          phases: successPhases(),
          plan,
          error: null,
          raw: plan,
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        const apiError = err as ApiError;
        setActivePhases(errorPhases(0));
        addEntry({
          id,
          prompt,
          phases: errorPhases(0),
          plan: null,
          error: apiError?.error ? apiError : { error: { stage: "planner", message: String(err) } },
          raw: apiError,
          timestamp: Date.now(),
        });
      } finally {
        setLoading(false);
      }
    },
    [walletAddress, addEntry]
  );

  // Actions whose calldata contains embedded swap quotes (LiFi/Pendle) that
  // expire ~60-120s after the plan was built. For these, we re-simulate right
  // before signing to get fresh calldata and avoid FAILED_WOULD_REVERT.
  const STALE_CALLDATA_ACTIONS = new Set(["strategy", "leverage", "swapAndDeposit", "bridge"]);

  const handleConfirm = useCallback(
    async (plan: FortressPlan) => {
      if (!isConnected) {
        addEntry({
          id: crypto.randomUUID(),
          prompt: "⚠️ Connect your wallet first to sign",
          phases: successPhases(),
          plan: null,
          error: null,
          raw: null,
          timestamp: Date.now(),
        });
        return;
      }

      setConfirming(true);
      try {
        // Re-simulate to get fresh swap calldata for time-sensitive intents
        let freshTxs = plan.transactions;
        if (STALE_CALLDATA_ACTIONS.has(plan.intent.action)) {
          try {
            const freshPlan = await resimulate(walletAddress, plan.intent);
            if (freshPlan.simulation.success) {
              freshTxs = freshPlan.transactions;
            }
            // If re-simulation fails, fall through to the original plan
          } catch {
            // Re-simulation failed — proceed with original calldata as a best-effort
          }
        }

        const hashes = await sign(freshTxs);

        // Best-effort: kick off position discovery so the new leverage/strategy
        // position appears on the next PositionsPanel poll. Never fail the sign on this.
        if (POSITION_ACTIONS.has(plan.intent.action)) {
          refreshPositions(walletAddress).catch(() => {});
        }

        addEntry({
          id: crypto.randomUUID(),
          prompt: `✅ Submitted ${hashes.length} transaction(s)`,
          phases: successPhases(),
          plan: null,
          error: null,
          raw: { hashes },
          timestamp: Date.now(),
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const rejected = /reject|denied/i.test(message);
        addEntry({
          id: crypto.randomUUID(),
          prompt: rejected ? "⚠️ Transaction rejected" : `❌ Execution failed: ${message.slice(0, 120)}`,
          phases: rejected ? successPhases() : errorPhases(2),
          plan: null,
          error: null,
          raw: { error: message },
          timestamp: Date.now(),
        });
      } finally {
        setConfirming(false);
      }
    },
    [isConnected, sign, addEntry, walletAddress]
  );

  const handleReject = useCallback((entryId: string) => {
    setHistory((h) => h.filter((e) => e.id !== entryId));
  }, []);

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">FORTRESS — Prompt to DeFi</h1>
          <p className="text-xs text-zinc-500 mt-1">
            One prompt, one signature. Backend @ localhost:3000
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAuthenticated && authWallet && (
            <span className="text-xs text-green-400">● Authenticated</span>
          )}
          <WalletConnect />
          {isAuthenticated && (
            <button
              onClick={logout}
              className="px-3 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-xs hover:bg-zinc-700 transition-colors"
            >
              Sign Out
            </button>
          )}
        </div>
      </header>

      <AuthGate>
        <PositionsPanel />

        <WithdrawPanel />

        <StrategiesPanel onTry={handleSubmit} />

        <section className="mb-6">
          <div className="mb-4">
            <PipelineStages phases={activePhases} />
          </div>
          <ChatInput onSubmit={handleSubmit} disabled={loading} />
        </section>

        <section className="space-y-6">
          {history.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl border border-zinc-800 bg-[#0a0a0f] p-5 space-y-4"
            >
              <div>
                <p className="text-sm text-zinc-300 font-mono">{entry.prompt}</p>
                <p className="text-xs text-zinc-600 mt-1">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </p>
              </div>

              <PipelineStages phases={entry.phases} />

              {entry.error && <ErrorDisplay error={entry.error} />}

              {entry.plan && (
                <PreviewCard
                  plan={entry.plan}
                  onConfirm={() => handleConfirm(entry.plan!)}
                  onReject={() => handleReject(entry.id)}
                  confirming={confirming}
                />
              )}

              {entry.raw != null && <RawDataViewer label="Raw API Response" data={entry.raw} />}
            </div>
          ))}
        </section>

        {history.length === 0 && !loading && (
          <div className="text-center py-20">
            <p className="text-zinc-600 text-sm">Enter a prompt to start</p>
            <p className="text-zinc-700 text-xs mt-2">
              Examples: &quot;Deposit 500 USDC&quot; • &quot;Convert 1 ETH and lend it&quot; •
              &quot;Bridge 1000 USDC to Arbitrum&quot;
            </p>
          </div>
        )}
      </AuthGate>
    </main>
  );
}
