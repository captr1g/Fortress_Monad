"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_GROUPS,
  CHAINS,
  formatTvl,
  searchActions,
  tokensFromRegistryChain,
  type Action,
  type ActionGroup,
  type SmartAction,
  type WizardToken,
} from "@/lib/actions";
import { useRegistry } from "@fortress/core/hooks";
import { cn } from "@/lib/cn";
import { PrimaryButton } from "@/components/ui/PrimaryButton";
import { ProtocolMark, TokenIcon, NetworkIcon } from "./icons";
import { MONAD_CHAIN_ID } from "@/lib/chains";

export type Step = "action" | "chain" | "token" | "amount";
export type Draft = {
  toolId?: string;
  label?: string;
  protocol?: string;
  chainId?: number;
  token?: { symbol: string; address: string };
};

// Multi-step Smart Action wizard: Action → Chain → Token → Amount → Confirm.
// Single-chain actions skip the chain step. esc closes; the breadcrumb goes back.
export function ActionPicker({
  onSelect,
  onClose,
  style,
  initial,
}: {
  onSelect: (action: SmartAction) => void;
  onClose: () => void;
  style?: React.CSSProperties;
  initial?: { draft: Draft; step: Step; amountPct?: number };
}) {
  const [step, setStep] = useState<Step>(initial?.step ?? "action");
  const [draft, setDraft] = useState<Draft>(initial?.draft ?? {});
  const [amountPct, setAmountPct] = useState(initial?.amountPct ?? 100);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // First step still missing a selection. Lets re-picking an earlier step skip
  // ahead instead of walking the user through every step again.
  function nextStep(d: Draft): Step {
    if (chainsFor(d.toolId).length > 1 && d.chainId == null) return "chain";
    if (!d.token) return "token";
    return "amount";
  }

  function pickAction(action: Action, protocol: string) {
    const single = action.chains.length === 1;
    // Keep every other selection; only the action changes. A single-chain action
    // forces its chain, otherwise the previously chosen chain is preserved.
    const next: Draft = {
      ...draft,
      toolId: action.toolId,
      label: action.label,
      protocol,
      chainId: single ? action.chains[0] : draft.chainId,
    };
    setDraft(next);
    setStep(nextStep(next));
  }

  function pickChain(chainId: number) {
    // Keep the token; only the chain changes.
    const next: Draft = { ...draft, chainId };
    setDraft(next);
    setStep(nextStep(next));
  }

  function pickToken(token: WizardToken) {
    setDraft((d) => ({ ...d, token: { symbol: token.symbol, address: token.address } }));
    setStep("amount");
  }

  function confirm() {
    if (!draft.toolId || !draft.label || !draft.protocol || draft.chainId == null || !draft.token) return;
    onSelect({
      toolId: draft.toolId,
      label: draft.label,
      protocol: draft.protocol,
      chainId: draft.chainId,
      token: draft.token,
      amountPct,
    });
  }

  function back() {
    setStep((s) => {
      if (s === "amount") return "token";
      // Single-chain actions skipped the chain step, so step back to action.
      if (s === "token") return chainsFor(draft.toolId).length > 1 ? "chain" : "action";
      return "action";
    });
  }

  return (
    <div
      ref={ref}
      style={style}
      className="absolute z-50 overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]"
    >
      <Breadcrumbs step={step} draft={draft} onBack={back} onJump={setStep} />

      {step === "action" && <ActionStep onPick={pickAction} selectedToolId={draft.toolId} />}
      {step === "chain" && draft && (
        <ChainStep chains={chainsFor(draft.toolId)} onPick={pickChain} />
      )}
      {step === "token" && draft.chainId != null && (
        <TokenStep chainId={draft.chainId} onPick={pickToken} />
      )}
      {step === "amount" && <AmountStep pct={amountPct} setPct={setAmountPct} onConfirm={confirm} />}

      <Footer hint={step === "amount" ? "select" : "navigate"} />
    </div>
  );
}

function chainsFor(toolId?: string): number[] {
  for (const group of ACTION_GROUPS) {
    const action = group.actions.find((a) => a.toolId === toolId);
    if (action) return action.chains;
  }
  return [];
}

// ─── Shared chrome ──────────────────────────────────────────────────────────

type Crumb = { key: string; label: string; value: string; step: Step };

function Breadcrumbs({
  step,
  draft,
  onBack,
  onJump,
}: {
  step: Step;
  draft: Draft;
  onBack: () => void;
  onJump: (step: Step) => void;
}) {
  const titles: Record<Step, string> = {
    action: "Select action",
    chain: "Select chain",
    token: "Select token",
    amount: "Set amount",
  };

  // Every selection still in the draft, except the one being edited right now,
  // collapsed into the "…" popover and each clickable to jump back to it.
  const crumbs: Crumb[] = [];
  if (chainsFor(draft.toolId).length > 1 && draft.chainId != null && step !== "chain") {
    crumbs.push({ key: "chain", label: "Chain", value: CHAINS[draft.chainId]?.label ?? "", step: "chain" });
  }
  if (draft.token && step !== "token") {
    crumbs.push({ key: "token", label: "Token", value: draft.token.symbol, step: "token" });
  }

  return (
    <div className="flex items-center gap-1.5 border-b border-line-soft px-3 py-2.5 text-[12.5px]">
      {step !== "action" && (
        <button
          onClick={onBack}
          aria-label="Back"
          className="flex h-5 w-5 flex-none items-center justify-center rounded text-muted transition hover:bg-elevated hover:text-fg-soft"
        >
          ‹
        </button>
      )}
      <span className="mono flex-none rounded bg-elevated px-1.5 py-0.5 text-[11px] text-muted">/</span>

      {/* Action crumb — click to go back and change the action */}
      {draft.label && step !== "action" && (
        <>
          <CrumbButton onClick={() => onJump("action")} title="Change action">
            {draft.label}
          </CrumbButton>
          <Sep />
        </>
      )}

      {/* Prior selections (chain / token), collapsed and clickable */}
      {crumbs.length > 0 && (
        <>
          <SelectionsPopover crumbs={crumbs} onJump={onJump} />
          <Sep />
        </>
      )}

      <span className="flex-none font-medium text-fg-soft">{titles[step]}</span>
    </div>
  );
}

function Sep() {
  return <span className="flex-none text-faint">›</span>;
}

function CrumbButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="group flex-none rounded-md px-1.5 py-0.5 text-muted transition-colors hover:bg-elevated hover:text-fg-soft"
    >
      {children}
    </button>
  );
}

function SelectionsPopover({ crumbs, onJump }: { crumbs: Crumb[]; onJump: (step: Step) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative flex-none"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Show earlier selections"
        className={cn(
          "rounded-md px-1.5 py-0.5 transition-colors hover:bg-elevated",
          open ? "bg-elevated text-muted" : "text-faint hover:text-muted",
        )}
      >
        …
      </button>
      {open && (
        // pt acts as a hover bridge so moving into the card doesn't close it.
        <div className="absolute left-0 top-full z-50 pt-1.5">
          <div className="w-max min-w-[200px] rounded-lg border border-line bg-surface p-1 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)]">
            <div className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-faint">
              Go back to
            </div>
            {crumbs.map((c) => (
              <button
                key={c.key}
                onClick={() => {
                  onJump(c.step);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left transition hover:bg-elevated"
              >
                <span className="text-[12px] text-faint">{c.label}</span>
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-fg-soft">
                  {c.value}
                  <span className="text-faint">↺</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}

function SearchRow({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line-soft px-4">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden className="flex-none">
        <circle cx="6" cy="6" r="4.25" stroke="#6b6b73" strokeWidth="1.5" />
        <path d="M9.5 9.5L12 12" stroke="#6b6b73" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
      />
    </div>
  );
}

function Footer({ hint }: { hint: "navigate" | "select" }) {
  return (
    <div className="flex items-center justify-between border-t border-line-soft px-4 py-2 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        {hint === "navigate" && (
          <>
            <Kbd>↑↓</Kbd> navigate
            <span className="mx-1 text-line">·</span>
          </>
        )}
        <Kbd>↵</Kbd> select
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>esc</Kbd> close
      </span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="mono rounded bg-elevated px-1.5 py-0.5 text-[10.5px] text-muted">{children}</span>
  );
}

function ScrollList({ children }: { children: React.ReactNode }) {
  return <div className="fx-scroll max-h-[280px] overflow-y-auto py-1">{children}</div>;
}

function Empty() {
  return <p className="px-4 py-6 text-center text-[12.5px] text-faint">Nothing matches.</p>;
}

// ─── Step: action (grouped by protocol) ─────────────────────────────────────

function ActionStep({
  onPick,
  selectedToolId,
}: {
  onPick: (a: Action, protocol: string) => void;
  selectedToolId?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const [prevSelectedIndex, setPrevSelectedIndex] = useState(0);

  const groups = useMemo(() => searchActions(ACTION_GROUPS, query), [query]);
  const flat = useMemo(
    () =>
      groups.flatMap((g) =>
        g.actions.filter((a) => a.enabled).map((a) => ({ action: a, protocol: g.protocol })),
      ),
    [groups],
  );
  const indexOf = useMemo(() => new Map(flat.map((s, i) => [s.action.toolId, i])), [flat]);

  // When returning to this step, pre-highlight the action already chosen.
  const selectedIndex = selectedToolId ? indexOf.get(selectedToolId) ?? 0 : 0;

  if (query !== prevQuery || selectedIndex !== prevSelectedIndex) {
    setPrevQuery(query);
    setPrevSelectedIndex(selectedIndex);
    setActive(query ? 0 : selectedIndex);
  }
  useListNav(flat.length, active, setActive, () => {
    const s = flat[active];
    if (s) onPick(s.action, s.protocol);
  });

  const activeToolId = flat[active]?.action.toolId;

  return (
    <>
      <SearchRow value={query} onChange={setQuery} placeholder="Type action, protocol, or chain…" />
      <ScrollList>
        {groups.length === 0 ? (
          <Empty />
        ) : (
          groups.map((group) => (
            <ActionGroupRows
              key={group.protocol}
              group={group}
              activeToolId={activeToolId}
              selectedToolId={selectedToolId}
              onHover={(id) => {
                const i = indexOf.get(id);
                if (i !== undefined) setActive(i);
              }}
              onPick={onPick}
            />
          ))
        )}
      </ScrollList>
    </>
  );
}

function ActionGroupRows({
  group,
  activeToolId,
  selectedToolId,
  onHover,
  onPick,
}: {
  group: ActionGroup;
  activeToolId?: string;
  selectedToolId?: string;
  onHover: (toolId: string) => void;
  onPick: (a: Action, protocol: string) => void;
}) {
  return (
    <div className="px-1.5 pb-1">
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ProtocolMark name={group.protocol} size={18} />
        <span className="text-[12px] font-medium text-fg-soft">{group.protocol}</span>
      </div>
      {group.actions.map((action) => {
        const disabled = !action.enabled;
        return (
          <button
            key={action.toolId}
            type="button"
            disabled={disabled}
            onMouseEnter={() => onHover(action.toolId)}
            onClick={() => onPick(action, group.protocol)}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
              disabled 
                ? "cursor-not-allowed opacity-40" 
                : action.toolId === selectedToolId 
                  ? "bg-white/10 text-white" 
                  : action.toolId === activeToolId 
                    ? "bg-white/5" 
                    : "hover:bg-white/5",
            )}
          >
            <span className={cn("flex items-center gap-2 text-[13px]", action.toolId === selectedToolId ? "text-fg font-medium" : "text-fg-soft")}>
              {action.label}
            </span>
            <span className="flex items-center gap-2">
              {disabled && (
                <span className="rounded bg-line px-1.5 py-0.5 text-[10px] text-faint">Soon</span>
              )}
              <ChainBadges chains={action.chains} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Step: chain ────────────────────────────────────────────────────────────

function ChainStep({ chains, onPick }: { chains: number[]; onPick: (id: number) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const filtered = useMemo(
    () => chains.filter((id) => CHAINS[id]?.label.toLowerCase().includes(query.trim().toLowerCase())),
    [chains, query],
  );

  if (query !== prevQuery) {
    setPrevQuery(query);
    setActive(0);
  }
  useListNav(filtered.length, active, setActive, () => {
    const id = filtered[active];
    if (id != null && id === MONAD_CHAIN_ID) onPick(id);
  });

  return (
    <>
      <SearchRow value={query} onChange={setQuery} placeholder="Type chain name…" />
      <ScrollList>
        {filtered.length === 0 ? (
          <Empty />
        ) : (
          <div className="px-1.5">
            {filtered.map((id, i) => {
              const disabled = id !== MONAD_CHAIN_ID;
              return (
                <button
                  key={id}
                  disabled={disabled}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => !disabled && onPick(id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2.5 text-left",
                    disabled ? "cursor-not-allowed opacity-40" : i === active ? "bg-elevated" : "",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <ChainIcon id={id} />
                    <span className="text-[13px] text-fg-soft">{CHAINS[id]?.label}</span>
                  </div>
                  {disabled && (
                    <span className="rounded bg-line px-1.5 py-0.5 text-[10px] text-faint">Soon</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollList>
    </>
  );
}

// ─── Step: token ────────────────────────────────────────────────────────────

function TokenStep({ chainId, onPick }: { chainId: number; onPick: (t: WizardToken) => void }) {
  const { data: registry, isLoading } = useRegistry();
  const tokens = useMemo(
    () => tokensFromRegistryChain(registry?.chains.find((c) => c.chainId === chainId)),
    [registry, chainId],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [prevQuery, setPrevQuery] = useState(query);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q),
    );
  }, [tokens, query]);

  if (query !== prevQuery) {
    setPrevQuery(query);
    setActive(0);
  }
  useListNav(filtered.length, active, setActive, () => {
    const t = filtered[active];
    if (t) onPick(t);
  });

  return (
    <>
      <SearchRow value={query} onChange={setQuery} placeholder="Type token name or symbol…" />
      <ScrollList>
        {isLoading ? (
          <TokenListSkeleton />
        ) : filtered.length === 0 ? (
          <Empty />
        ) : (
          <div className="px-1.5">
            {filtered.map((token, i) => (
              <button
                key={token.symbol}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(token)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left",
                  i === active ? "bg-elevated" : "",
                )}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <TokenIcon symbol={token.symbol} address={token.address} size={26} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-fg-soft">
                      {token.symbol} <span className="text-muted">{token.name}</span>
                    </span>
                    <span className="mono block truncate text-[10.5px] text-muted">{token.address}</span>
                  </span>
                </span>
                {token.apy != null && (
                  <span className="flex-none text-right">
                    <span className="mono text-[12.5px] font-semibold text-green">
                      {token.apy.toFixed(2)}%
                    </span>
                    {token.tvlUsd != null && (
                      <span className="mono block text-[10px] text-faint">{formatTvl(token.tvlUsd)}</span>
                    )}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </ScrollList>
    </>
  );
}

function TokenListSkeleton() {
  return (
    <div className="px-1.5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2.5 px-2.5 py-2">
          <div className="h-[26px] w-[26px] flex-none animate-pulse rounded-full bg-elevated" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-[11px] w-20 animate-pulse rounded bg-elevated" />
            <div className="h-[9px] w-32 animate-pulse rounded bg-elevated" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Step: amount ───────────────────────────────────────────────────────────

function AmountStep({
  pct,
  setPct,
  onConfirm,
}: {
  pct: number;
  setPct: (n: number) => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onConfirm]);

  return (
    <div className="px-4 py-4">
      <h4 className="text-[13px] font-medium text-fg-soft">Allocation</h4>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Smart Action uses 100% by default. Adjust how much of the position this step uses.
      </p>
      <div className="mt-4 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => setPct(Number(e.target.value))}
          className="flex-1 accent-[#10b981]"
        />
        <div className="mono w-16 rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-right text-[13px]">
          {pct}
          <span className="text-faint">%</span>
        </div>
      </div>
      <div className="mono mt-1 flex justify-between text-[10px] text-faint">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <PrimaryButton onClick={onConfirm} className="mt-4">
        Confirm
      </PrimaryButton>
    </div>
  );
}

// ─── Small visuals + nav hook ───────────────────────────────────────────────

function ChainBadges({ chains }: { chains: number[] }) {
  const shown = chains.slice(0, 3);
  const extra = chains.length - shown.length;
  return (
    <span className="flex items-center gap-1">
      {shown.map((id) => (
        <ChainIcon key={id} id={id} size={18} />
      ))}
      {extra > 0 && <span className="text-[11px] text-faint">+{extra}</span>}
    </span>
  );
}

function ChainIcon({ id, size = 22 }: { id: number; size?: number }) {
  const meta = CHAINS[id];
  if (!meta) return null;
  return (
    <span title={meta.label}>
      <NetworkIcon network={meta.label.toLowerCase()} size={size} />
    </span>
  );
}

// Up/down/enter navigation shared by the list steps.
function useListNav(count: number, active: number, setActive: (fn: (i: number) => number) => void, onEnter: () => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, count - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        onEnter();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [count, active, setActive, onEnter]);
}
