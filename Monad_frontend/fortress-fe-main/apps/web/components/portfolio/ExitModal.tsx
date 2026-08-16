"use client";

import { useState, useEffect, useRef } from "react";
import { TokenIcon } from "@/components/strategy/icons";
import {
  useExitPosition,
  formatReceive,
  type ExitMode,
} from "./useExitPosition";
import type { MorphoPosition } from "./useMorphoPositions";
import { motion, AnimatePresence } from "framer-motion";

interface ExitModalProps {
  position: MorphoPosition;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

const MODE_OPTIONS: { mode: ExitMode; label: string; description: string }[] = [
  {
    mode: "full_to_loan",
    label: "Close → receive USDC",
    description: "Repay all debt, sell collateral, return remaining as USDC.",
  },
  {
    mode: "full_to_collateral",
    label: "Repay, keep collateral",
    description: "Repay all debt by selling only enough collateral to cover it.",
  },
  {
    mode: "deleverage",
    label: "Reduce leverage",
    description: "Partially repay so LTV drops to a target, keeping the position open.",
  },
];

export function ExitModal({ position, walletAddress, onClose, onSuccess }: ExitModalProps) {
  const [mode, setMode] = useState<ExitMode>("full_to_loan");
  const [targetLtv, setTargetLtv] = useState(
    parseFloat((position.ltv * 0.6).toFixed(2)) // default: 60 % of current LTV
  );

  const { phase, preview, buildError, txError, txStep, build, confirm, reset } =
    useExitPosition();

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // When confirmed, notify parent to refresh then close. `onSuccess`/`onClose`
  // come from the parent as fresh closures on every render (Portfolio.tsx's
  // refreshAll isn't memoized against stable deps), so depending on them
  // directly re-ran this effect — and cancelled the pending timeout via its
  // cleanup — on any unrelated parent re-render during the 1.8s window,
  // sometimes indefinitely postponing it so the refresh/close never actually
  // fired. Reading them through refs means the effect only keys on the real
  // phase transition into "confirmed", while still calling the latest
  // versions of both callbacks when the timer lands.
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  onSuccessRef.current = onSuccess;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (phase === "confirmed") {
      const t = setTimeout(() => {
        onSuccessRef.current();
        onCloseRef.current();
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [phase]);

  function handleBuild() {
    build({
      walletAddress,
      market: position.id, // id = marketKey
      mode,
      ...(mode === "deleverage" ? { targetLtv: Number(targetLtv.toFixed(4)) } : {}),
    });
  }

  const isBuilding   = phase === "building";
  const isSigning    = phase === "signing";
  const isConfirmed  = phase === "confirmed";
  const isError      = phase === "error";
  const showPreview  = phase === "preview" || isSigning || isConfirmed || isError;

  const txCount = preview?.transactions.length ?? 0;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-xl"
          onClick={onClose}
        />

        {/* Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative z-10 flex max-h-[90dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0a0a0c]/80 shadow-[0_0_80px_-20px_rgba(255,255,255,0.05)] backdrop-blur-2xl"
          // Adding a subtle radial gradient for glassmorphism
          style={{ backgroundImage: "radial-gradient(circle at top, rgba(255,255,255,0.03) 0%, transparent 100%)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <TokenIcon symbol={position.collateralSymbol} size={32} />
                <span className="absolute -bottom-1 -right-1 rounded-full bg-[#0a0a0c] p-0.5">
                  <TokenIcon symbol={position.borrowSymbol} size={16} />
                </span>
              </div>
              <div>
                <div className="text-[15px] font-semibold text-white/90">{position.market}</div>
                <div className="text-[12px] font-medium text-white/40">Exit position</div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="group flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <svg className="h-4 w-4 transition-transform group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <AnimatePresence mode="wait">
              {!showPreview ? (
                <motion.div
                  key="selection"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="mb-4 text-[13px] font-semibold text-white/60">Select exit mode</div>
                  <div className="flex flex-col gap-3 mb-6">
                    {MODE_OPTIONS.map((opt) => {
                      const isActive = mode === opt.mode;
                      return (
                        <motion.button
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          key={opt.mode}
                          onClick={() => setMode(opt.mode)}
                          className={`group relative overflow-hidden rounded-2xl border px-5 py-4 text-left transition-all ${
                            isActive
                              ? "border-white/30 bg-white/10 shadow-[0_0_20px_-5px_rgba(255,255,255,0.1)]"
                              : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"
                          }`}
                        >
                          {isActive && (
                            <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/5 to-white/0 blur-xl" />
                          )}
                          <div className="relative flex items-center justify-between">
                            <span className={`text-[14px] font-semibold ${isActive ? "text-white" : "text-white/80 group-hover:text-white"}`}>
                              {opt.label}
                            </span>
                          </div>
                          <div className={`relative mt-1.5 text-[12.5px] ${isActive ? "text-white/70" : "text-white/40"}`}>
                            {opt.description}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>

                  <AnimatePresence>
                    {mode === "deleverage" && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-5">
                          <div className="mb-4 flex items-center justify-between text-[13px]">
                            <span className="font-medium text-white/50">Target LTV</span>
                            <span className="mono font-bold text-white/90">{(targetLtv * 100).toFixed(0)}%</span>
                          </div>
                          <input
                            type="range"
                            min={0.05}
                            max={parseFloat((position.maxLtv - 0.05).toFixed(2))}
                            step={0.01}
                            value={targetLtv}
                            onChange={(e) => setTargetLtv(parseFloat(e.target.value))}
                            className="w-full accent-white"
                          />
                          <div className="mt-2 flex justify-between text-[11px] font-medium text-white/40">
                            <span>5%</span>
                            <span className="text-white/70">Current {(position.ltv * 100).toFixed(1)}%</span>
                            <span>Max {(position.maxLtv * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Current position snapshot */}
                  <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-5 text-[13px]">
                    <div className="mb-3 text-[12px] font-medium text-white/50">Current position</div>
                    <div className="grid grid-cols-3 gap-4">
                      <Stat label="Collateral" value={`$${position.collateralUsd.toFixed(2)}`} />
                      <Stat label="Debt" value={`$${position.borrowUsd.toFixed(2)}`} />
                      <Stat label="LTV" value={`${(position.ltv * 100).toFixed(1)}%`} />
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {preview && (
                    <>
                      <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5">
                        <div className="mb-1.5 text-[12px] font-medium text-white/50">Summary</div>
                        <div className="text-[14px] font-semibold leading-relaxed text-white/90">
                          {preview.description}
                        </div>
                      </div>

                      {/* Settlement breakdown */}
                      <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-5 text-[13px]">
                        <div className="mb-3 text-[12px] font-medium text-white/50">Settlement Preview</div>
                        <div className="flex flex-col gap-2.5">
                          <SettlementRow
                            label="Debt repaid"
                            value={formatReceive(preview.settlement.debtRepaid, preview.position.loanToken)}
                          />
                          {preview.settlement.collateralSold !== "0" && (
                            <SettlementRow
                              label="Collateral sold"
                              value={formatReceive(preview.settlement.collateralSold, preview.position.collateralToken)}
                            />
                          )}
                          {preview.settlement.collateralReturned !== "0" && (
                            <SettlementRow
                              label="Collateral returned"
                              value={formatReceive(preview.settlement.collateralReturned, preview.position.collateralToken)}
                            />
                          )}
                          <div className="mt-2 flex items-center justify-between rounded-xl bg-[#4ade80]/10 border border-[#4ade80]/20 px-4 py-3">
                            <span className="font-semibold text-[#4ade80]">You receive</span>
                            <span className="mono font-bold text-[#4ade80]">
                              {formatReceive(preview.settlement.expectedReceive, preview.settlement.receiveToken)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Simulation */}
                      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-[13px]">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4ade80]/20">
                          <svg className="h-4 w-4 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="font-medium text-white/80">Simulation passed</span>
                        <span className="mono ml-auto text-[12px] text-white/40">~{Number(preview.simulation.gasUsed).toLocaleString()} gas</span>
                      </div>

                      {/* Tx progress */}
                      {(isSigning || isConfirmed) && (
                        <div className="mb-5 rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/5 p-5 relative overflow-hidden">
                          <div className="absolute top-0 right-0 w-32 h-32 bg-[#a78bfa]/10 blur-3xl -z-10 rounded-full mix-blend-screen" />
                          <div className="mb-3 text-[12px] font-medium text-[#a78bfa]/80">
                            Signing {txCount} transaction{txCount !== 1 ? "s" : ""}
                          </div>
                          <div className="flex flex-col gap-3">
                            {preview.transactions.map((_, i) => {
                              const done = isConfirmed || i < txStep;
                              const active = !isConfirmed && i === txStep;
                              return (
                                <div key={i} className="flex items-center gap-3 text-[13px]">
                                  <div className={`flex h-6 w-6 flex-none items-center justify-center rounded-full border ${
                                    done
                                      ? "border-[#4ade80]/30 bg-[#4ade80]/20 text-[#4ade80]"
                                      : active
                                      ? "border-[#a78bfa]/50 bg-[#a78bfa]/20 shadow-[0_0_10px_rgba(167,139,250,0.3)]"
                                      : "border-white/10 bg-white/5"
                                  }`}>
                                    {done ? (
                                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : active ? (
                                      <span
                                        className="h-2.5 w-2.5 rounded-full border-2 border-[#a78bfa]"
                                        style={{ borderTopColor: "transparent", animation: "fspin .7s linear infinite" }}
                                      />
                                    ) : (
                                      <span className="text-[10px] text-white/30">{i + 1}</span>
                                    )}
                                  </div>
                                  <span className={`font-medium ${active ? "text-white" : done ? "text-white/60" : "text-white/30"}`}>
                                    {i === 0 && txCount > 1 ? "Authorize exit executor" : "Sign exit transaction"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Confirmed banner */}
                      <AnimatePresence>
                        {isConfirmed && (
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-5 flex items-center gap-3 rounded-2xl border border-[#4ade80]/30 bg-[#4ade80]/10 px-5 py-4"
                          >
                            <svg className="h-5 w-5 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-[14px] font-semibold text-[#4ade80]">Exit confirmed, refreshing portfolio…</span>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </>
                  )}

                  {/* ── Error ── */}
                  <AnimatePresence>
                    {isError && (buildError || txError) && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mb-5 rounded-2xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-5 shadow-[0_0_20px_-5px_rgba(239,68,68,0.2)]"
                      >
                        <div className="mb-2 text-[14px] font-bold text-[#ef4444]">
                          {txError ? "Transaction failed" : "Build failed"}
                        </div>
                        <div className="text-[13px] text-[#ef4444]/80 leading-relaxed font-medium">
                          {txError ?? buildError}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer actions */}
          <div className="border-t border-white/5 px-6 py-5 flex items-center gap-4 bg-black/20">
            {!showPreview ? (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onClose}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[14px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={!isBuilding ? { scale: 1.02 } : {}}
                  whileTap={!isBuilding ? { scale: 0.98 } : {}}
                  onClick={handleBuild}
                  disabled={isBuilding}
                  className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black transition-all hover:shadow-[0_0_15px_rgba(255,255,255,0.3)] disabled:opacity-50 disabled:hover:shadow-none"
                >
                  {isBuilding ? (
                    <>
                      <span
                        className="h-4 w-4 rounded-full border-2 border-black/30"
                        style={{ borderTopColor: "black", animation: "fspin .7s linear infinite" }}
                      />
                      Building…
                    </>
                  ) : (
                    "Preview exit"
                  )}
                </motion.button>
              </>
            ) : isConfirmed ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
              >
                Done
              </motion.button>
            ) : isError ? (
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { reset(); }}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[14px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Change mode
                </motion.button>
                <motion.button
                  whileHover={!isBuilding ? { scale: 1.02 } : {}}
                  whileTap={!isBuilding ? { scale: 0.98 } : {}}
                  onClick={handleBuild}
                  disabled={isBuilding}
                  className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)] disabled:opacity-50"
                >
                  Retry
                </motion.button>
              </>
            ) : (
              <>
                <motion.button
                  whileHover={!isSigning ? { scale: 1.02 } : {}}
                  whileTap={!isSigning ? { scale: 0.98 } : {}}
                  onClick={reset}
                  disabled={isSigning}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[14px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  Back
                </motion.button>
                <motion.button
                  whileHover={!isSigning ? { scale: 1.02, boxShadow: "0 0 20px rgba(239, 68, 68, 0.4)" } : {}}
                  whileTap={!isSigning ? { scale: 0.98 } : {}}
                  onClick={confirm}
                  disabled={isSigning}
                  className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#ef4444] to-[#f87171] text-[14px] font-bold text-white shadow-[0_0_15px_rgba(239,68,68,0.2)] disabled:opacity-50"
                >
                  {isSigning ? (
                    <>
                      <span
                        className="h-4 w-4 rounded-full border-2 border-white/30"
                        style={{ borderTopColor: "#fff", animation: "fspin .7s linear infinite" }}
                      />
                      Signing…
                    </>
                  ) : (
                    "Confirm & sign"
                  )}
                </motion.button>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-white/40 mb-1">{label}</div>
      <div className="mono font-semibold text-white/90">{value}</div>
    </div>
  );
}

function SettlementRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-medium text-white/60">{label}</span>
      <span className="mono font-semibold text-white/90">{value}</span>
    </div>
  );
}
