"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { TopBar } from "./TopBar";
import { AmbientAurora } from "./AmbientAurora";
import { PANEL_TRANSITION } from "@/lib/motion";

const PILLARS = [
  {
    title: "Discover",
    desc: "Browse strategies published by the community, ranked by live performance.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    title: "Publish",
    desc: "Sign in with X and put your best strategies in front of everyone.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5" />
        <path d="M5 12l7-7 7 7" />
      </svg>
    ),
  },
];

export function MarketplaceTeaser() {
  const router = useRouter();

  return (
    <div className="relative flex min-h-dvh flex-col">
      <TopBar />

      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <AmbientAurora opacity={0.14} />

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={PANEL_TRANSITION}
          className="relative z-10 w-full max-w-[560px] px-5 py-16 text-center"
        >
          <div className="mb-3 inline-flex items-center rounded-full border border-line px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.2em] text-muted">
            Coming soon
          </div>

          <h1 className="text-[32px] font-bold tracking-tight sm:text-[38px]">
            Strategy <span className="text-muted">Marketplace</span>
          </h1>
          <p className="mx-auto mt-3 max-w-[420px] text-[14.5px] leading-relaxed text-muted">
            A public gallery of community strategies. Discover what&apos;s working,
            deploy in one click, and publish your own.
          </p>

          <div className="mx-auto mt-10 grid max-w-[440px] gap-3 sm:grid-cols-2">
            {PILLARS.map((p, i) => (
              <motion.div
                key={p.title}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...PANEL_TRANSITION, delay: 0.12 + i * 0.08 }}
                className="rounded-2xl border border-line-soft bg-surface/80 p-4 text-left backdrop-blur-sm"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-line-soft bg-surface-2 text-muted">
                  {p.icon}
                </div>
                <div className="text-[13.5px] font-semibold text-fg">{p.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">{p.desc}</p>
              </motion.div>
            ))}
          </div>

          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...PANEL_TRANSITION, delay: 0.4 }}
            onClick={() => router.push("/prompt")}
            className="mt-10 inline-flex h-11 items-center rounded-full bg-fg px-7 text-[14px] font-semibold text-ink transition-transform active:scale-[0.98] hover:opacity-90"
          >
            Build your own now →
          </motion.button>
        </motion.div>
      </div>
    </div>
  );
}
