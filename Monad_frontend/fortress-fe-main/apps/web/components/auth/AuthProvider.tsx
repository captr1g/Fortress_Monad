"use client";

import { createContext, useCallback, useContext, useEffect, useState, useRef } from "react";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { useAppKit } from "@reown/appkit/react";
import { fortressApi, siweMessage } from "@fortress/core/api";
import { useToastStore } from "@/store/toast";

type Status = "loading" | "unauthenticated" | "authenticated";

type AuthValue = {
  status: Status;
  address?: string;
  isConnected: boolean;
  isAuthenticating: boolean;
  error?: string;
  /** Open the wallet-connect modal. */
  connect: () => void;
  /** Run the SIWE handshake (connects first if needed). */
  signIn: () => Promise<void>;
  /** Clear the backend session and disconnect the wallet. */
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { open, close } = useAppKit();

  const toast = useToastStore();
  const [status, setStatus] = useState<Status>("loading");
  // The address the backend session actually belongs to, from /auth/me — set
  // once on load and kept for as long as the session itself is valid (7
  // days), independent of whether the in-browser wallet connection survived
  // a browser restart. Most apps don't sign you out just because the wallet
  // extension locked itself; this is what lets Fortress do the same instead
  // of falling back to "Connect wallet" every time the wallet hasn't
  // reconnected yet.
  const [sessionAddress, setSessionAddress] = useState<string>();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const lastPromptedAddress = useRef<string | null>(null);
  const hasInitiatedSignIn = useRef(false);

  // Prefer the live wagmi connection when it's actually there (it's the one
  // that can sign), otherwise fall back to the session's own address so the
  // user still reads as logged in — with their real address — before the
  // wallet has reconnected. `isConnected` (from wagmi, exposed below)
  // remains the accurate signal for "can this actually sign something right
  // now"; screens that need a live wallet (deploy, exit) should gate on
  // that, not on `status`/`address` alone.
  const effectiveAddress = address ?? sessionAddress;

  // Still guard the one truly broken case — an authenticated session that
  // somehow carries no address at all (neither live nor from the session
  // payload) — but a live-vs-session address distinction is no longer part
  // of that check.
  const effectiveStatus: Status =
    status === "authenticated" && !effectiveAddress ? "unauthenticated" : status;

  // The actual SIWE handshake: request a nonce, sign it with the wallet, hand
  // the signature to the backend. No confirmation screen in between — once
  // the wallet address is known, this goes straight to the wallet's own
  // signature prompt, which already tells the user what they're signing.
  const completeSignIn = useCallback(async () => {
    setIsAuthenticating(true);
    try {
      const { nonce } = await fortressApi.requestNonce(address!);
      const signature = await signMessageAsync({ message: siweMessage(nonce, address!) });
      await fortressApi.verifySignature(address!, signature);
      setStatus("authenticated");
    } catch (e) {
      console.error("[FortressAuth] Sign-in error:", e);
      toast.error(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setIsAuthenticating(false);
    }
  }, [address, signMessageAsync, toast]);

  useEffect(() => {
    // Automatically continue straight into the SIWE signature once a wallet
    // connects, but ONLY if the user explicitly initiated a sign-in.
    if (
      address &&
      status === "unauthenticated" &&
      hasInitiatedSignIn.current &&
      address !== lastPromptedAddress.current
    ) {
      lastPromptedAddress.current = address;
      close(); // forcefully close AppKit
      hasInitiatedSignIn.current = false;
      completeSignIn();
    }

    // Reset when disconnected
    if (!address) {
      lastPromptedAddress.current = null;
    }
  }, [address, status, close, completeSignIn]);

  // Restore an existing cookie session on load.
  useEffect(() => {
    let active = true;
    fortressApi
      .getSession()
      .then((s) => {
        if (!active) return;
        setStatus(s.authenticated ? "authenticated" : "unauthenticated");
        setSessionAddress(s.walletAddress);
      })
      .catch(() => active && setStatus("unauthenticated"));
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    hasInitiatedSignIn.current = true;
    if (!address) {
      open();
      return;
    }
    await completeSignIn();
  }, [address, open, completeSignIn]);

  const signOut = useCallback(async () => {
    try {
      await fortressApi.logout();
    } catch {
      // clear locally regardless of network result
    }
    disconnect();
    setStatus("unauthenticated");
    setSessionAddress(undefined);
  }, [disconnect]);

  return (
    <AuthContext.Provider
      value={{
        status: effectiveStatus,
        address: effectiveAddress,
        isConnected,
        isAuthenticating,
        error: undefined,
        connect: open,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
