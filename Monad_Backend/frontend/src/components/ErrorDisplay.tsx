"use client";

import type { ApiError } from "@/lib/api";

export function ErrorDisplay({ error }: { error: ApiError }) {
  const { stage, message, details } = error.error;

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-red-500/20">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <h3 className="text-sm font-semibold text-red-400">
            Cannot process — {stage}
          </h3>
        </div>
      </div>

      <div className="px-5 py-4 space-y-3">
        <p className="text-sm text-red-300 font-mono">{message}</p>

        {details && Object.keys(details).length > 0 && (
          <pre className="text-xs text-zinc-400 font-mono mt-1 p-3 rounded-lg bg-[#0a0a0f] overflow-x-auto">
            {JSON.stringify(details, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
