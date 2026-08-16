"use client";

import { useToastStore } from "@/store/toast";

function ToastIcon({ type }: { type: "success" | "error" | "info" }) {
  if (type === "success") {
    return (
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-green/30 bg-green/10 text-green">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (type === "error") {
    return (
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-red/30 bg-red/10 text-red">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border border-line bg-surface-2 text-muted">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </span>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex w-80 items-start gap-3 rounded-xl border border-line-soft bg-surface p-3.5 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85)] backdrop-blur-md"
          style={{ animation: "ffadein 0.3s ease both" }}
        >
          <ToastIcon type={toast.type} />
          <div className="line-clamp-4 flex-1 pt-1 text-[13px] font-medium leading-snug text-fg-soft">
            {toast.message}
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            className="flex-none rounded-md p-1 text-faint transition hover:bg-elevated hover:text-fg-soft"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
