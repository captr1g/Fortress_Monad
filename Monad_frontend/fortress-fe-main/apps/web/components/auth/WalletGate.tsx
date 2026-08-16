"use client";

import { useAuth } from "./AuthProvider";
import { PrimaryButton } from "@/components/ui/PrimaryButton";

// Wraps wallet-requiring UI. While a user explores unauthenticated, this renders
// a connect/sign-in prompt (the fallback) instead of the gated content.
export function WalletGate({
  children,
  connectLabel = "Connect wallet",
  fallback,
}: {
  children: React.ReactNode;
  connectLabel?: string;
  fallback?: React.ReactNode;
}) {
  const { status, signIn } = useAuth();

  if (status === "loading") {
    return <div className="h-11 w-full rounded-lg border border-line bg-surface" />;
  }
  if (status === "authenticated") return <>{children}</>;

  // signIn() already handles both "not connected yet" (opens the wallet
  // picker) and "connected but not signed in" (opens the SIWE verify modal)
  // — calling bare connect() here skipped the flag that lets AuthProvider
  // auto-continue into the sign prompt once the wallet connects, leaving
  // the user connected but stuck needing a second manual click.
  return (
    fallback ?? (
      <PrimaryButton onClick={() => signIn()}>
        {connectLabel}
      </PrimaryButton>
    )
  );
}
