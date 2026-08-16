"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useCreatePlan } from "@fortress/core/hooks";
import { FortressApiError } from "@fortress/core";
import type { Strategy } from "@/lib/strategy";
import { previewToStrategy } from "@/lib/mapPreview";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/cn";
import { PromptComposer } from "./PromptComposer";
import { TopBar } from "./TopBar";
import { TokenIcon } from "./icons";
import { TokenSelect, tokenAddressForSymbol } from "./TokenSelect";
import { useSimulation } from "./useSimulation";
import { DeployAction, MetricRow, StepsPanel, SaveStrategyAction, SimulationBanner } from "./StrategyResult";
import { AmbientAurora } from "./AmbientAurora";
import { PANEL_TRANSITION, PHASE_TRANSITION } from "@/lib/motion";

type Phase = "splash" | "compose" | "generating" | "result" | "error";
type Template = { label: string; token: string; desc: string; prompt: string };
type Built = { strategy: Strategy; planId?: string; preview?: import("@fortress/core").Preview };
type BuildError = {
  stage?: string;
  category?: string;
  message: string;
  suggestions?: import("@fortress/core").Suggestion[];
};

const TEMPLATES: Template[] = [
  {
    label: "Basic Morpho Borrow",
    token: "USDC",
    desc: "Supply cbETH collateral to Morpho and borrow USDC against it safely.",
    prompt:
      "I have 1 USDC on Base.\n\n" +
      "1. Swap 100% USDC to WETH.\n" +
      "2. Wrap 100% WETH into cbETH.\n" +
      "3. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base.\n" +
      "4. Borrow USDC at 30% LTV against cbETH.",
  },
  {
    label: "Morpho Leverage Loop (2x)",
    token: "USDC",
    desc: "Supply cbETH and automate a recursive 35% LTV borrow-swap-supply loop twice.",
    prompt:
      "I have 1 USDC on Base.\n\n" +
      "1. Swap 100% USDC to WETH.\n" +
      "2. Wrap 100% WETH into cbETH.\n" +
      "3. Supply 100% cbETH as collateral to Morpho market cbETH-USDC on Base.\n\n" +
      "Then repeat 2 times:\n" +
      "4. Borrow USDC at 35% LTV.\n" +
      "5. Swap borrowed USDC to WETH.\n" +
      "6. Wrap WETH into cbETH.\n" +
      "7. Supply 100% cbETH.",
  },
  {
    label: "Deposit 100 USDC into Morpho",
    token: "USDC",
    desc: "Supply 100 USDC to Morpho for a steady yield.",
    prompt:
      "I have 100 USDC on Base.\n\n" +
      "1. Supply 100% USDC to Morpho on Base.",
  },
];

// Shared with the right panel's enter/exit so the aside's resize and the
// panel's slide move in sync instead of a bouncy spring racing an eased tween.
// (Timing constants live in lib/motion so every page shares the same voice.)

export function StrategyBuilder() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { status, address } = useAuth();
  const createPlan = useCreatePlan();

  const paramPrompt = searchParams.get("prompt") ?? "";
  const autorun = searchParams.get("autorun") === "1";
  const autorunFired = useRef(false);

  const [phase, setPhase] = useState<Phase>(autorun && paramPrompt ? "compose" : "splash");
  const [prompt, setPrompt] = useState(paramPrompt);
  const [name, setName] = useState("");
  const [startingToken, setStartingToken] = useState("USDC");
  const [result, setResult] = useState<Built | null>(null);
  const [error, setError] = useState<BuildError>();

  const sim = useSimulation(result?.strategy.steps.length ?? 0);
  const started = phase === "generating" || phase === "result" || phase === "error";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/");
    }
  }, [status, router]);

  useEffect(() => {
    if (!autorun || !paramPrompt || autorunFired.current) return;
    if (status === "loading") return;
    autorunFired.current = true;
    run(paramPrompt, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autorun, paramPrompt, status]);

  // Walk the steps once the result lands.
  useEffect(() => {
    if (phase === "result") sim.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function run(p: string, n: string) {
    if (!p.trim() || !startingToken) return;
    // Guarded by the redirect effect above and the unauthenticated early
    // return below — this only ever runs once the session is authenticated,
    // which (per AuthProvider) guarantees address is set too.
    if (!address) return;
    setError(undefined);
    setPhase("generating");
    // The starting token travels as a structured, backend-validated field —
    // not free prompt text the planner can ignore.
    const inputToken = tokenAddressForSymbol(startingToken);

    createPlan.mutate(
      { prompt: p, walletAddress: address, chainId: 8453, inputToken, name: n || undefined },
      {
        onSuccess: (preview) => {
          const strat = previewToStrategy(preview, { prompt: p, name: n });
          if (!n) setName(strat.name); // seed the editable name from the generated one
          setResult({ strategy: strat, planId: preview.planId, preview });
          setPhase("result");
        },
        onError: (e) => {
          setError(
            e instanceof FortressApiError
              ? { stage: e.stage, category: e.category, message: e.message, suggestions: e.suggestions }
              : { message: e instanceof Error ? e.message : "Couldn't generate the strategy." },
          );
          setPhase("error");
        },
      },
    );
  }

  function reset() {
    setResult(null);
    setError(undefined);
    setPhase("compose");
  }

  // Suggestion chip: append the required line to the prompt and hand the
  // user back to the composer to review and regenerate.
  function applySuggestion(insertText: string) {
    setPrompt((p) => (p.trim() ? `${p.trimEnd()}\n${insertText}` : insertText));
    setError(undefined);
    setPhase("compose");
  }

  // Amount re-simulation succeeded — swap the whole result so metrics, steps,
  // tx count, and deploy artifacts all reflect the new amount.
  function applySimulated(preview: import("@fortress/core").Preview) {
    const strat = previewToStrategy(preview, { prompt, name });
    setResult({ strategy: strat, planId: preview.planId, preview });
  }

  function useTemplate(t: Template) {
    setPrompt(t.prompt);
    setStartingToken(t.token);
    setName("");
    setError(undefined);
    setPhase("compose");
  }

  if (status === "unauthenticated" || status === "loading") {
    return null;
  }

  const txCount = result?.preview?.artifacts?.length ?? 0;
  const promptChanged = !!result && prompt !== result.strategy.prompt;

  return (
    <div className="relative flex h-dvh flex-col">
      <AmbientAurora />
      <TopBar />

      <main className="relative mx-auto flex w-full max-w-[1320px] flex-1 overflow-y-auto md:overflow-hidden">
        <AnimatePresence mode="wait">
        {phase === "splash" ? (
          <motion.div
            key="splash"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.4 }}
            className="relative z-10 flex flex-1"
          >
            <Splash onStart={() => setPhase("compose")} onTemplate={useTemplate} />
          </motion.div>
        ) : (
          <motion.div
            key="flow"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.25 }}
            className="relative z-10 flex w-full flex-1 flex-col gap-5 overflow-visible p-4 md:flex-row md:overflow-hidden md:p-[22px]"
          >
            {/* Left column — persists and slides left on generate. Full-width
                and stacked above the right panel on mobile; fixed-width and
                side-by-side from md up. */}
            <motion.aside
              layout
              initial={{ opacity: 0, y: 80 }}
              animate={{ opacity: 1, y: 0 }}
              transition={PANEL_TRANSITION}
              className={cn(
                "flex flex-none flex-col gap-3.5",
                started ? "w-full md:w-[384px]" : "mx-auto w-full max-w-[620px] pt-[3vh] md:pt-[5vh]",
              )}
            >
              {!started && (
                <button
                  onClick={() => setPhase("splash")}
                  className="mb-6 flex items-center gap-1.5 self-start text-[13px] font-medium text-white/40 transition-colors hover:text-white/80"
                >
                  <svg className="h-[14px] w-[14px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  Back
                </button>
              )}

              {/* Island: name + starting token (one-shot golden glow) */}
              <div className="flex items-center justify-between gap-4">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Name this strategy…"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-fg outline-none placeholder:text-faint"
                />
                <div className="token-glow inline-flex rounded-lg">
                  <TokenSelect value={startingToken} onChange={setStartingToken} />
                </div>
              </div>

              <PromptComposer value={prompt} onChange={setPrompt} />

              {/* Action area — crossfades between phases instead of popping
                  instantly, so it doesn't fight the aside's own resize. */}
              <AnimatePresence mode="wait">
                {phase === "compose" && (
                  <motion.div
                    key="compose"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={PHASE_TRANSITION}
                    className="flex flex-col gap-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="mono text-[11.5px] text-faint">
                        <kbd className="rounded bg-line px-1.5 py-0.5 text-muted">/</kbd> for actions
                      </span>
                      <button
                        onClick={() => run(prompt, name)}
                        disabled={!prompt.trim() || createPlan.isPending}
                        className="h-10 rounded-lg bg-fg px-7 text-[14px] font-semibold text-ink transition active:scale-[0.99] disabled:opacity-40"
                      >
                        Generate
                      </button>
                    </div>
                  </motion.div>
                )}

                {phase === "generating" && (
                  <motion.div
                    key="generating"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={PHASE_TRANSITION}
                  >
                    <button disabled className="flex h-10 w-full items-center justify-center gap-2.5 rounded-lg border border-line-soft bg-surface-2 text-[13.5px] font-semibold text-muted">
                      <span className="h-3.5 w-3.5 rounded-full border-2 border-line" style={{ borderTopColor: "#888", animation: "fspin .7s linear infinite" }} />
                      Generating…
                    </button>
                  </motion.div>
                )}

                {phase === "result" && result && (
                  <motion.div
                    key="result"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={PHASE_TRANSITION}
                    className="flex flex-col gap-3.5"
                  >
                    {promptChanged && (
                      <button onClick={() => run(prompt, name)} className="h-9 rounded-lg bg-fg text-[13px] font-semibold text-ink transition active:scale-[0.99]">
                        Regenerate strategy
                      </button>
                    )}
                    <DeployAction
                      planId={result.planId}
                      name={name}
                      strategy={result.strategy}
                      txCount={txCount}
                      preview={result.preview}
                      onSimulated={applySimulated}
                    />
                    <SaveStrategyAction name={name} strategy={result.strategy} preview={result.preview} />
                  </motion.div>
                )}

                {phase === "error" && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={PHASE_TRANSITION}
                    className="flex flex-col gap-2.5"
                  >
                    {error?.suggestions && error.suggestions.length > 0 && (
                      <div className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-surface-2 p-3">
                        <div className="text-[10px] uppercase tracking-widest text-faint">Suggestions</div>
                        {error.suggestions.map((s, i) =>
                          s.insertText ? (
                            <button
                              key={i}
                              onClick={() => applySuggestion(s.insertText!)}
                              className="self-start rounded-full border border-green/25 bg-green/10 px-3 py-1.5 text-left text-[12px] font-medium text-green-bright transition hover:bg-green/20"
                            >
                              + {s.label}
                            </button>
                          ) : (
                            <p key={i} className="text-[12px] leading-relaxed text-muted">
                              {s.label}
                            </p>
                          ),
                        )}
                      </div>
                    )}
                    <div className="flex gap-2.5">
                      <button
                        onClick={() => setPhase("compose")}
                        className="h-10 flex-1 rounded-lg border border-line bg-surface-2 text-[13.5px] font-semibold text-fg-soft transition hover:bg-elevated active:scale-[0.99]"
                      >
                        Edit prompt
                      </button>
                      <button
                        onClick={() => run(prompt, name)}
                        className="h-10 flex-1 rounded-lg bg-fg text-[13.5px] font-semibold text-ink transition active:scale-[0.99]"
                      >
                        Try again
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.aside>

            {/* Right column — reveals on generate. On mobile it stacks below
                the aside rather than beside it, so it needs its own explicit
                height for its internal scroll areas (StepsPanel etc.) to have
                room — flex-1 alone collapses to nothing once the page itself
                scrolls instead of the row being height-bound. */}
            <AnimatePresence>
              {started && (
                <motion.section
                  key="right"
                  layout
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={PANEL_TRANSITION}
                  className="flex min-h-[70vh] min-w-0 flex-1 flex-col md:min-h-0"
                >
                  {phase === "generating" ? (
                    <RightGenerating />
                  ) : phase === "error" ? (
                    <RightError error={error} onRetry={() => run(prompt, name)} onEdit={() => setPhase("compose")} />
                  ) : result ? (
                    <RightResult
                      strategy={result.strategy}
                      preview={result.preview}
                      sim={sim}
                      onCancel={reset}
                      onApplySuggestion={applySuggestion}
                    />
                  ) : null}
                </motion.section>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ─── Splash ───────────────────────────────────────────────────────────────────

// Ambient spectrum visualizer — soft vertical bars blurred into a pulsing band
// of light (equalizer-inspired, not orbs or literal waves). Bars use flex-1 so
// the band always spans the full width, and colors stay within the app's
// existing token palette (no one-off accent colors).
function Splash({ onStart, onTemplate }: { onStart: () => void; onTemplate: (t: Template) => void }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center px-5" style={{ animation: "ffadein .5s ease both" }}>
      <div className="relative z-10 flex flex-col items-center">
        <h1 className="text-center text-[32px] font-bold tracking-tight sm:text-[40px]">
          What do you want to do <span className="text-muted">on-chain?</span>
        </h1>

        <button
          onClick={onStart}
          className="mt-8 inline-flex h-12 items-center rounded-full bg-fg px-8 text-[15px] font-semibold text-ink transition-transform active:scale-[0.98] hover:opacity-90"
        >
          Start
        </button>

        <div className="mt-12 flex w-full max-w-[520px] items-center gap-3">
          <div className="h-px flex-1 bg-line-soft" />
          <span className="text-[11px] uppercase tracking-[0.16em] text-faint">Templates</span>
          <div className="h-px flex-1 bg-line-soft" />
        </div>

        <div className="mt-6 flex flex-wrap items-start justify-center gap-3">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.label} t={t} onClick={() => onTemplate(t)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// Description is always shown, full-height, in normal flow — except on
// devices whose primary input can actually hover ((hover: hover), not just a
// width breakpoint — a touchscreen laptop is desktop-sized but still can't
// hover), where it collapses to a short row and grows over its neighbors on
// hover, matching the original desktop design. Touch never gets a hover-only
// reveal, since hover never fires there and a tap would pick a template blind.
function TemplateCard({ t, onClick }: { t: Template; onClick: () => void }) {
  return (
    <div className="relative w-full sm:w-[185px] [@media(hover:hover)]:h-[54px]">
      <button
        onClick={onClick}
        className="group w-full rounded-xl border border-line-soft bg-surface/70 p-4 text-left backdrop-blur transition-all duration-300 hover:border-line hover:bg-surface [@media(hover:hover)]:absolute [@media(hover:hover)]:inset-x-0 [@media(hover:hover)]:top-0 [@media(hover:hover)]:z-10 [@media(hover:hover)]:overflow-hidden [@media(hover:hover)]:hover:z-20 [@media(hover:hover)]:hover:shadow-[0_16px_40px_-16px_rgba(0,0,0,0.85)]"
      >
        <div className="flex items-center gap-2">
          <TokenIcon symbol={t.token} size={17} />
          <span className="text-[13.5px] font-semibold">{t.label}</span>
        </div>
        <div className="max-h-28 opacity-100 transition-all duration-300 [@media(hover:hover)]:max-h-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:max-h-28 [@media(hover:hover)]:group-hover:opacity-100">
          <p className="pt-2.5 text-[12px] leading-relaxed text-muted">{t.desc}</p>
        </div>
      </button>
    </div>
  );
}

// ─── Right column ─────────────────────────────────────────────────────────────

// The loader previews the exact layout the result lands in — a metric row +
// a step list — built from the same card shapes/colors as RightResult below,
// not an invented decoration. When the real data arrives it fills into the
// same slots instead of swapping to an unrelated screen.
function RightGenerating() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-[18px]">
        <div className="text-[18px] font-bold tracking-tight">Building your strategy</div>
        <div className="mono mt-1.5 text-[12px] text-faint">this usually takes a few seconds</div>
      </div>
      <GhostMetricRow />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line/30 bg-surface-2/40 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-none items-center justify-between border-b border-line/40 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="mono flex h-[17px] w-[17px] items-center justify-center rounded-[5px] bg-line text-[8px] text-muted">F</span>
            <span className="text-[12.5px] font-semibold">Assembling</span>
          </div>
          <span className="mono text-[11.5px] text-faint">{mm}:{ss}</span>
        </div>
        <div className="fx-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <GhostStepList />
        </div>
      </div>
    </div>
  );
}

// A softly breathing placeholder bar — same visual role a shimmer sweep would
// play, but built as one of our own primitives (a pill) rather than a
// borrowed generic-skeleton effect.
function GhostBar({ w, delay = 0 }: { w: number; delay?: number }) {
  return (
    <span
      className="inline-block h-2.5 rounded-full bg-white/10"
      style={{ width: w, animation: `fghost 1.8s ease-in-out ${delay}s infinite` }}
    />
  );
}

// Mirrors MetricRow's exact card shapes (StrategyResult.tsx) with bars in
// place of real numbers: Net APY tile, Breakdown chips, Steps tile.
function GhostMetricRow() {
  return (
    <div className="mb-3 flex gap-2">
      <div className="flex min-w-[168px] flex-none flex-col justify-center gap-2 rounded-xl bg-line-soft px-5 py-3.5">
        <GhostBar w={52} />
        <GhostBar w={84} delay={0.1} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-2 rounded-xl bg-line-soft px-4 py-3.5">
        <GhostBar w={60} delay={0.05} />
        <div className="flex gap-1.5">
          <div className="rounded-lg border border-line/40 bg-surface-2/60 px-2.5 py-1.5"><GhostBar w={64} delay={0.2} /></div>
          <div className="rounded-lg border border-line/40 bg-surface-2/60 px-2.5 py-1.5"><GhostBar w={58} delay={0.3} /></div>
        </div>
      </div>
      <div className="flex min-w-[150px] flex-none flex-col justify-center gap-2 rounded-xl bg-line-soft px-5 py-3.5">
        <GhostBar w={40} delay={0.05} />
        <GhostBar w={26} delay={0.2} />
      </div>
    </div>
  );
}

// Mirrors RegularStep/StepInner's exact card shape (StepCard.tsx) with bars
// in place of real action/protocol/token text.
function GhostStepList() {
  const widths = [72, 58, 66, 50];
  return (
    <div className="mx-auto flex max-w-[420px] flex-col">
      {widths.map((w, i) => (
        <div key={i}>
          {i > 0 && (
            <div className="flex justify-center py-1">
              <svg className="h-2.5 w-2.5 text-white/15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          )}
          <div className="flex rounded-xl bg-[#161619]">
            <div className="flex w-9 flex-none items-start justify-center pt-2.5">
              <span className="font-mono text-[16px] font-bold text-white/10">{i + 1}</span>
            </div>
            <div className="my-[6px] mr-[6px] flex-1 rounded-lg bg-[#0e0e11]">
              <div className="flex items-baseline justify-between px-3 pt-2 pb-[5px]">
                <GhostBar w={w} delay={i * 0.15} />
                <GhostBar w={30} delay={i * 0.15 + 0.1} />
              </div>
              <div className="mx-3 h-px bg-white/[.04]" />
              <div className="flex items-center justify-between px-3 pt-[5px] pb-2">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-3.5 w-3.5 rounded-full bg-white/10"
                    style={{ animation: `fghost 1.8s ease-in-out ${i * 0.15}s infinite` }}
                  />
                  <GhostBar w={38} delay={i * 0.15 + 0.05} />
                </div>
                <GhostBar w={26} delay={i * 0.15 + 0.2} />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

const STAGE_COPY: Record<string, string> = {
  planner: "translating your prompt into a plan",
  resolver: "finding a route across protocols",
  validator: "checking the plan",
  builder: "preparing the transactions",
  simulator: "test-running the strategy on-chain",
  api: "reaching the Fortress backend",
};

function friendlyStage(stage?: string) {
  return (stage && STAGE_COPY[stage]) || "putting your strategy together";
}

function friendlySuggestion(category?: string) {
  if (category === "network") return "Check your connection and try again.";
  if (category === "auth") return "Reconnect your wallet, then try again.";
  if (category === "timeout") return "This can happen when things are busy — try again in a moment.";
  return "Try adjusting your prompt, or try again in a moment.";
}

function RightError({
  error,
  onRetry,
  onEdit,
}: {
  error?: BuildError;
  onRetry: () => void;
  onEdit: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-[18px]">
        <div className="text-[18px] font-bold tracking-tight">Building your strategy</div>
        <div className="mono mt-1.5 text-[12px] text-faint">stopped early</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-amber/20 bg-[#0c0c0e] px-8 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-full border border-amber/30 bg-amber/[.08] text-[18px] text-amber">
          !
        </span>
        <div className="max-w-[340px]">
          {error?.category === "rate_limit" ? (
            <>
              <div className="text-[14.5px] font-semibold text-fg-soft">Daily limit reached</div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{error.message}</div>
            </>
          ) : (
            <>
              <div className="text-[14.5px] font-semibold text-fg-soft">
                Couldn&apos;t finish {friendlyStage(error?.stage)}
              </div>
              <div className="mt-1.5 text-[13px] leading-relaxed text-muted">{friendlySuggestion(error?.category)}</div>
            </>
          )}
        </div>
        <div className="flex gap-2.5">
          <button onClick={onEdit} className="h-9 rounded-lg border border-line bg-surface-2 px-4 text-[12.5px] font-semibold text-fg-soft transition hover:bg-elevated">
            Edit prompt
          </button>
          <button onClick={onRetry} className="h-9 rounded-lg bg-fg px-4 text-[12.5px] font-semibold text-ink transition active:scale-[0.99]">
            Try again
          </button>
        </div>
        {error?.message && (
          <button onClick={() => setShowDetails((v) => !v)} className="mono text-[10.5px] text-faint transition hover:text-muted">
            {showDetails ? "Hide" : "Show"} technical details
          </button>
        )}
        {showDetails && error?.message && (
          <div className="mono max-w-[380px] rounded-lg border border-line-soft bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-faint">
            {error.stage && <span>{error.stage} · </span>}
            {error.message}
          </div>
        )}
      </div>
    </div>
  );
}

function RightResult({
  strategy,
  preview,
  sim,
  onCancel,
  onApplySuggestion,
}: {
  strategy: Strategy;
  preview?: import("@fortress/core").Preview;
  sim: import("./useSimulation").Simulation;
  onCancel: () => void;
  onApplySuggestion: (insertText: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ animation: "ffadein .35s ease both" }}>
      <div className="mb-3.5 flex justify-end">
        <button
          onClick={onCancel}
          className="h-8 rounded border border-white/10 bg-[#161619] px-3 text-[11px] font-medium text-white/40 transition hover:text-white hover:bg-white/5"
        >
          Discard
        </button>
      </div>
      <SimulationBanner preview={preview} />
      <MetricRow strategy={strategy} preview={preview} />
      {preview?.loopSuggestion && (
        <LoopSuggestionChip suggestion={preview.loopSuggestion} onApply={onApplySuggestion} />
      )}
      <StepsPanel strategy={strategy} sim={sim} />
    </div>
  );
}

// A better-yield upsell, not an error recovery hint — only ever shown when
// looping the user's own starting asset projects to a real, clearly-better
// net APY than the plan they're already looking at (see loop-suggestion.ts
// on the backend: negative or marginal projections never reach here).
function LoopSuggestionChip({
  suggestion,
  onApply,
}: {
  suggestion: NonNullable<import("@fortress/core").Preview["loopSuggestion"]>;
  onApply: (insertText: string) => void;
}) {
  return (
    <button
      onClick={() => onApply(suggestion.insertText)}
      className="mb-3.5 flex w-full items-center gap-3 rounded-xl border border-[color-mix(in_oklab,var(--color-gold)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-gold)_8%,transparent)] px-4 py-3 text-left transition hover:bg-[color-mix(in_oklab,var(--color-gold)_14%,transparent)]"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--color-gold)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-gold)_16%,transparent)] text-gold">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-fg">{suggestion.label}</div>
        <div className="mt-0.5 text-[11.5px] text-muted">Tap to try this instead</div>
      </span>
    </button>
  );
}

