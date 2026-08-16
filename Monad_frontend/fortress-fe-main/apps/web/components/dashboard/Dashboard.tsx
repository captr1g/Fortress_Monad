"use client";

import { useState } from "react";
import { useStrategies } from "@fortress/core/hooks";
import { MOCK_STRATEGIES } from "@/lib/mockStrategies";
import { CatalogCard } from "./CatalogCard";

function HeroCard({ title, subtitle, tvf, accent }: { title: string; subtitle: string; tvf: string; accent: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line-soft bg-surface p-6 transition-transform hover:-translate-y-1">
      <div
        className="absolute -right-16 -top-16 h-44 w-44 rounded-full blur-[80px] transition-opacity group-hover:opacity-100"
        style={{ background: accent, opacity: 0.18 }}
      />
      <div className="relative z-10 flex flex-col">
        <div className="mb-8 flex h-11 w-11 items-center justify-center rounded-xl border border-line-soft bg-surface-2">
          <div className="h-5 w-5 rounded-md" style={{ background: accent }} />
        </div>
        <h2 className="mb-1 text-[17px] font-bold">{title}</h2>
        <p className="text-[13px] text-muted">{subtitle}</p>
        <div className="mt-6 flex items-end justify-between">
          <div className="mono text-[20px] font-bold">{tvf}</div>
          <div className="text-[11px] font-medium text-faint">TVF</div>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { data, isLoading } = useStrategies(undefined);
  const [tab, setTab] = useState<"all" | "verified">("all");
  const [query, setQuery] = useState("");

  const source = data?.strategies?.length ? data.strategies : MOCK_STRATEGIES;
  const list = source.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col p-8 pb-20">
      {/* Hero categories */}
      <div className="mb-10 grid gap-5 md:grid-cols-3">
        <HeroCard title="Base Strategies" subtitle="Trending strategies on the Base chain" tvf="$12,851,003.75" accent="#3b82f6" />
        <HeroCard title="Reward-Boosted" subtitle="Extra yield from protocol incentives" tvf="$31,001,984.86" accent="#8b5cf6" />
        <HeroCard title="Stablecoin Vaults" subtitle="Low-risk yield on stable assets" tvf="$8,293,441.12" accent="var(--color-green)" />
      </div>

      {/* Filter bar */}
      <div className="mb-8 flex flex-col justify-between gap-4 border-b border-line-soft pb-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-6">
          {(["all", "verified"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[14px] font-medium transition-colors ${tab === t ? "text-fg" : "text-muted hover:text-fg-soft"}`}
            >
              {t === "all" ? "All Strategies" : "Verified Strategies"}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, asset, strategist…"
              className="h-9 w-[260px] rounded-full border border-line-soft bg-surface pl-9 pr-4 text-[13px] text-fg placeholder:text-faint outline-none focus:border-line"
            />
          </div>
          <button className="flex h-9 items-center gap-2 rounded-full border border-line-soft bg-surface px-4 text-[13px] font-medium text-fg-soft transition-colors hover:bg-surface-2">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            Filters
          </button>
          <button className="flex h-9 items-center gap-2 rounded-full border border-line-soft bg-surface px-4 text-[13px] font-medium text-fg-soft transition-colors hover:bg-surface-2">
            Sort by: TVF
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Catalog */}
      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[220px] animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-surface text-center">
          <div className="mb-2 text-[15px] font-semibold">No strategies match “{query}”</div>
          <button onClick={() => setQuery("")} className="text-[13px] text-green-bright hover:underline">
            Clear search
          </button>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {list.map((strategy) => (
            <CatalogCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      )}
    </div>
  );
}
