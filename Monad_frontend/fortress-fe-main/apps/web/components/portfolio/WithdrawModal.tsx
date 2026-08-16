"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TokenIcon, ProtocolMark } from "@/components/strategy/icons";
import { useWithdrawToken } from "./useWithdrawToken";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WithdrawModalToken {
  symbol: string;
  name: string;
  /** ERC-20 contract address — passed as `tokenAddress` to the API */
  address: string;
  decimals: number;
  /** Current wallet balance (already divided by 10^decimals) */
  balance: number;
}

interface WithdrawModalProps {
  token: WithdrawModalToken;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}

const PCT_PRESETS = [25, 50, 75, 100] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert raw USDC units (6 dp) to a display string */
function formatUsdc(raw: string): string {
  const n = Number(raw) / 1e6;
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WithdrawModal({
  token,
  walletAddress,
  onClose,
  onSuccess,
}: WithdrawModalProps) {
  // percentage 1-100, stored as a number
  const [pct, setPct] = useState<number | "">(25);

  const { phase, preview, txStep, txCount, error, build, confirm, reset } =
    useWithdrawToken();

  const isBuilding  = phase === "building";
  const isPreview   = phase === "preview";
  const isSigning   = phase === "signing";
  const isConfirmed = phase === "confirmed";
  const isError     = phase === "error";
  const isBusy      = isBuilding || isSigning;

  const parsedPct   = typeof pct === "number" ? pct : 0;
  const isEmpty     = parsedPct <= 0;
  const isOver      = parsedPct > 100;

  // Token amount that corresponds to the chosen percentage (for display only)
  const tokenAmount = token.balance > 0 ? (token.balance * parsedPct) / 100 : 0;

  // ── Close on Escape ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isBusy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, isBusy]);

  // ── Auto-close after confirmation ──
  useEffect(() => {
    if (isConfirmed) {
      const t = setTimeout(() => {
        onSuccess();
        onClose();
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [isConfirmed, onSuccess, onClose]);

  // ── Handlers ──
  function handleBuild() {
    if (isEmpty || isOver || isBusy) return;
    build({
      walletAddress,
      tokenAddress: token.address,
      amount: parsedPct.toString(),
      amountType: "percent",
    });
  }

  const showForm    = !isPreview && !isSigning && !isConfirmed && !(isError && preview);
  const showPreview = isPreview || isSigning || isConfirmed || (isError && !!preview);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-xl"
          onClick={() => !isBusy && onClose()}
        />

        {/* Panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative z-10 flex max-h-[90dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0a0a0c]/80 shadow-[0_0_80px_-20px_rgba(255,255,255,0.05)] backdrop-blur-2xl"
          style={{ backgroundImage: "radial-gradient(circle at top, rgba(255,255,255,0.03) 0%, transparent 100%)" }}
        >
          {/* ── Header ── */}
          <div className="flex items-center justify-between border-b border-white/5 px-6 py-5">
            <div className="flex items-center gap-3">
              <TokenIcon symbol={token.symbol} size={32} />
              <div>
                <div className="text-[15px] font-semibold text-white/90">{token.symbol}</div>
                <div className="text-[12px] font-medium text-white/40">
                  {showPreview ? "Confirm withdrawal" : "Withdraw"}
                </div>
              </div>
            </div>
            <button
              onClick={() => !isBusy && onClose()}
              disabled={isBusy}
              className="group flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/40 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
            >
              <svg className="h-4 w-4 transition-transform group-hover:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── Body ── */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <AnimatePresence mode="wait">

              {/* ── Confirmed ── */}
              {isConfirmed ? (
                <motion.div
                  key="confirmed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex flex-col items-center justify-center gap-4 py-8 text-center"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#4ade80]/30 bg-[#4ade80]/10">
                    <svg className="h-7 w-7 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div className="text-[16px] font-semibold text-[#4ade80]">Withdrawal confirmed</div>
                  <div className="text-[13px] text-white/40">Refreshing your portfolio…</div>
                </motion.div>

              ) : showPreview && preview ? (
                /* ── Preview + signing ── */
                <motion.div
                  key="preview"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Summary */}
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
                    <div className="mb-1 text-[12px] text-white/40">Summary</div>
                    <div className="text-[14px] font-semibold text-white/90">{preview.description}</div>
                  </div>

                  {/* Settlement details */}
                  <div className="mb-4 rounded-2xl border border-white/10 bg-white/5 p-5 text-[13px]">
                    <div className="mb-3 text-[12px] font-medium text-white/50">Settlement preview</div>
                    <div className="flex flex-col gap-2.5">
                      <PreviewRow label="Protocol" value={preview.protocol} />
                      <PreviewRow
                        label="Withdrawing"
                        value={`${parsedPct}% of ${token.symbol}`}
                        sub={tokenAmount > 0
                          ? tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " " + token.symbol
                          : undefined}
                      />
                      <div className="mt-1 flex items-center justify-between rounded-xl border border-[#4ade80]/20 bg-[#4ade80]/10 px-4 py-3">
                        <span className="font-semibold text-[#4ade80]">Min. you receive</span>
                        <span className="mono font-bold text-[#4ade80]">{formatUsdc(preview.minUsdcOut)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Simulation passed badge */}
                  <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-[13px]">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4ade80]/20">
                      <svg className="h-4 w-4 text-[#4ade80]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="font-medium text-white/80">Simulation passed</span>
                    <span className="mono ml-auto text-[12px] text-white/40">
                      ~{Number(preview.simulation.gasUsed).toLocaleString()} gas
                    </span>
                  </div>

                  {/* Tx signing progress */}
                  {isSigning && (
                    <div className="mb-4 rounded-2xl border border-[#a78bfa]/20 bg-[#a78bfa]/5 p-5">
                      <div className="mb-3 text-[12px] font-medium text-[#a78bfa]/80">
                        Signing {txCount} transaction{txCount !== 1 ? "s" : ""}
                      </div>
                      <div className="flex flex-col gap-3">
                        {Array.from({ length: txCount }).map((_, i) => {
                          const done   = i < txStep;
                          const active = i === txStep;
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
                                {i === 0 && txCount > 1 ? "Approve token spend" : "Sign withdraw transaction"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Error on preview screen */}
                  <AnimatePresence>
                    {isError && error && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="rounded-2xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-4"
                      >
                        <div className="mb-1 text-[13px] font-bold text-[#ef4444]">Transaction failed</div>
                        <div className="text-[12.5px] font-medium leading-relaxed text-[#ef4444]/80">{error}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>

              ) : (
                /* ── Percentage selection form ── */
                <motion.div
                  key="form"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2 }}
                >
                  {/* Balance info */}
                  <div className="mb-3 flex items-center justify-between text-[12.5px]">
                    <span className="text-white/40">Amount to withdraw</span>
                    <span className="text-white/40">
                      Balance:&nbsp;
                      <span className="mono font-semibold text-white/70">
                        {token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      &nbsp;{token.symbol}
                    </span>
                  </div>

                  {/* Percentage input */}
                  <div className={`relative mb-3 flex items-center rounded-2xl border bg-white/5 px-4 py-3.5 transition ${
                    isOver
                      ? "border-[#ef4444]/40 focus-within:border-[#ef4444]/60"
                      : "border-white/10 focus-within:border-white/25"
                  }`}>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      step="1"
                      placeholder="0"
                      value={pct}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPct(v === "" ? "" : Math.min(100, Math.max(0, Number(v))));
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleBuild()}
                      disabled={isBusy}
                      className="mono flex-1 bg-transparent text-[24px] font-bold text-white/90 placeholder-white/20 outline-none disabled:opacity-50"
                    />
                    <span className="mono ml-2 text-[20px] font-bold text-white/40">%</span>
                  </div>

                  {/* Token amount estimate */}
                  {parsedPct > 0 && !isOver && token.balance > 0 && (
                    <div className="mb-3 text-[12px] text-white/30 text-right">
                      ≈ {tokenAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
                    </div>
                  )}

                  {/* Over-100% warning */}
                  <AnimatePresence>
                    {isOver && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-3 overflow-hidden"
                      >
                        <div className="rounded-xl border border-[#ef4444]/20 bg-[#ef4444]/5 px-3.5 py-2.5 text-[12.5px] text-[#ef4444]">
                          Percentage cannot exceed 100%
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* % preset buttons */}
                  <div className="mb-6 grid grid-cols-4 gap-2">
                    {PCT_PRESETS.map((preset) => {
                      const active = parsedPct === preset;
                      return (
                        <button
                          key={preset}
                          onClick={() => setPct(preset)}
                          disabled={isBusy || token.balance <= 0}
                          className={`rounded-xl border py-2.5 text-[13px] font-semibold transition disabled:opacity-40 ${
                            active
                              ? "border-white/30 bg-white/10 text-white"
                              : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:bg-white/[0.08] hover:text-white/80"
                          }`}
                        >
                          {preset === 100 ? "Max" : `${preset}%`}
                        </button>
                      );
                    })}
                  </div>

                  {/* Token info */}
                  <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.03] px-4 py-3 text-[12.5px]">
                    <ProtocolMark name="Morpho" size={16} />
                    <span className="text-white/50">{token.name}</span>
                    <span className="mono ml-auto text-[11px] text-white/25">
                      {token.address.slice(0, 6)}…{token.address.slice(-4)}
                    </span>
                  </div>

                  {/* Build error */}
                  <AnimatePresence>
                    {isError && error && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="mt-4 rounded-2xl border border-[#ef4444]/30 bg-[#ef4444]/10 p-4"
                      >
                        <div className="mb-1 text-[13px] font-bold text-[#ef4444]">Withdraw failed</div>
                        <div className="text-[12.5px] font-medium leading-relaxed text-[#ef4444]/80">{error}</div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center gap-3 border-t border-white/5 bg-black/20 px-6 py-5">
            {isConfirmed ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="h-11 w-full rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]"
              >
                Done
              </motion.button>

            ) : isSigning ? (
              <button
                disabled
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 text-[14px] font-semibold text-white/40"
              >
                <span
                  className="h-4 w-4 rounded-full border-2 border-white/20"
                  style={{ borderTopColor: "rgba(255,255,255,0.6)", animation: "fspin .7s linear infinite" }}
                />
                Waiting for signature…
              </button>

            ) : isPreview ? (
              /* Preview confirmed, user hasn't signed yet */
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={reset}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[14px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Back
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(255,255,255,0.2)" }}
                  whileTap={{ scale: 0.98 }}
                  onClick={confirm}
                  className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black shadow-[0_0_15px_rgba(255,255,255,0.1)] transition-all"
                >
                  Confirm &amp; sign
                </motion.button>
              </>

            ) : (
              /* Form / error state */
              <>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => { reset(); onClose(); }}
                  disabled={isBusy}
                  className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 text-[14px] font-semibold text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileHover={!isBusy && !isEmpty && !isOver ? { scale: 1.02 } : {}}
                  whileTap={!isBusy && !isEmpty && !isOver ? { scale: 0.98 } : {}}
                  onClick={handleBuild}
                  disabled={isBusy || isEmpty || isOver}
                  className="flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-white to-white/90 text-[14px] font-bold text-black transition-all hover:shadow-[0_0_15px_rgba(255,255,255,0.25)] disabled:opacity-40 disabled:hover:shadow-none"
                >
                  {isBuilding ? (
                    <>
                      <span
                        className="h-4 w-4 rounded-full border-2 border-black/30"
                        style={{ borderTopColor: "black", animation: "fspin .7s linear infinite" }}
                      />
                      Preparing…
                    </>
                  ) : isError ? (
                    "Retry"
                  ) : (
                    "Preview withdrawal"
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

// ─── Small helpers ────────────────────────────────────────────────────────────

function PreviewRow({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="font-medium text-white/50">{label}</span>
      <div className="text-right">
        <span className="mono font-semibold text-white/90">{value}</span>
        {sub && <div className="mt-0.5 text-[11px] text-white/30">{sub}</div>}
      </div>
    </div>
  );
}
