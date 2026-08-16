"use client";

import { useState } from "react";

type Props = {
  label: string;
  data: unknown;
};

export function RawDataViewer({ label, data }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!data) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0a0a0f] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-zinc-400 hover:text-zinc-300 transition-colors"
      >
        <span>{label}</span>
        <span>{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <pre className="px-4 py-3 text-xs text-zinc-400 font-mono overflow-x-auto border-t border-zinc-800 max-h-[300px] overflow-y-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
