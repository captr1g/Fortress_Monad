"use client";

import { useState, type FormEvent } from "react";

type Props = {
  onSubmit: (prompt: string) => void;
  disabled: boolean;
};

export function ChatInput({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-3">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value.slice(0, 2000))}
        placeholder="Enter a DeFi prompt... e.g. 'Swap 1 ETH for USDC on Base'"
        disabled={disabled}
        className="flex-1 px-4 py-3 rounded-lg bg-[#12121a] border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 font-mono text-sm disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        className="px-6 py-3 rounded-lg bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Plan
      </button>
    </form>
  );
}
