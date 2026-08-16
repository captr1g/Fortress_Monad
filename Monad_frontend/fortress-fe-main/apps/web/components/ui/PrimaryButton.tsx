import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

// Single source of truth for the full-width primary button (white bg, dark text).
export function PrimaryButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-fg text-[14px] font-semibold text-ink transition active:scale-[0.99] disabled:opacity-50",
        className,
      )}
    />
  );
}
