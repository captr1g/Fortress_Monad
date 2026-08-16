"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/components/auth/AuthProvider";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { FortressMark } from "@/components/ui/FortressMark";
import { PANEL_TRANSITION } from "@/lib/motion";

const STEPS = [
  { n: "01", t: "Connect", d: "Connect your wallet and sign in. No passwords." },
  { n: "02", t: "Describe", d: "Say what you want in plain language." },
  { n: "03", t: "Deploy", d: "Approve once. Entry and exit run on-chain automatically." },
];

export function Onboarding() {
  const router = useRouter();
  const { status, isConnected, isAuthenticating, error, signIn } = useAuth();

  useEffect(() => {
    if (status === "authenticated") router.replace("/prompt");
  }, [status, router]);

  const label = isAuthenticating
    ? "Signing in…"
    : status === "loading"
      ? "Loading…"
      : isConnected
        ? "Sign in"
        : "Connect wallet";

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-[420px]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={PANEL_TRANSITION}
        >
          <div className="mb-8 flex items-center gap-2.5">
            <FortressMark size={34} className="text-white" />
            <div className="text-[20px] font-bold tracking-tight">Fortress</div>
            <span className="rounded-full border border-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted">
              Beta
            </span>
          </div>

          <h1 className="text-[26px] font-bold leading-tight tracking-tight">
            Autonomous DeFi strategies.
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            Describe a strategy in plain language. Fortress builds it, simulates it, and
            runs entry and exit on-chain automatically.
          </p>
        </motion.div>

        <div className="mt-8 flex flex-col gap-2.5">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.n}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...PANEL_TRANSITION, delay: 0.1 + i * 0.08 }}
              className="flex gap-3.5 rounded-xl border border-line-soft bg-surface px-4 py-3.5"
            >
              <span className="mono pt-px text-[12px] text-faint">{s.n}</span>
              <div>
                <div className="text-[13.5px] font-medium">{s.t}</div>
                <div className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{s.d}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ ...PANEL_TRANSITION, delay: 0.38 }}
        >
          <PrimaryButton
            onClick={() => signIn()}
            disabled={isAuthenticating || status === "loading"}
            className="mt-8"
          >
            {label}
          </PrimaryButton>
          {error && <p className="mt-3 text-center text-[12px] text-amber">{error}</p>}
        </motion.div>
      </div>
    </div>
  );
}
