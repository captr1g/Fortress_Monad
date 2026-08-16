"use client";

import { useAccount, useConnect } from "wagmi";
import { useAuth } from "@/hooks/useAuth";

type AuthGateProps = {
  children: React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { isAuthenticated, isAuthenticating, login } = useAuth();

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <p className="text-zinc-400 text-sm">Connect your wallet to continue</p>
        <button
          onClick={() => connect({ connector: connectors[0] })}
          className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <p className="text-zinc-400 text-sm">
          Sign a message to verify wallet ownership
        </p>
        <button
          onClick={login}
          disabled={isAuthenticating}
          className="px-6 py-3 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isAuthenticating ? "Signing..." : "Sign In"}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
