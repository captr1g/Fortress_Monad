"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount, useSignMessage } from "wagmi";

const API_BASE = "http://localhost:3000";

type AuthState = {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  walletAddress: string | null;
};

export function useAuth() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isAuthenticating: false,
    walletAddress: null,
  });
  const prevAddressRef = useRef<string | undefined>(undefined);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        credentials: "include",
      });
      const data = await res.json();
      if (data.authenticated) {
        setState({
          isAuthenticated: true,
          isAuthenticating: false,
          walletAddress: data.walletAddress,
        });
      } else {
        setState({
          isAuthenticated: false,
          isAuthenticating: false,
          walletAddress: null,
        });
      }
    } catch {
      setState({
        isAuthenticated: false,
        isAuthenticating: false,
        walletAddress: null,
      });
    }
  }, []);

  const login = useCallback(async () => {
    if (!address) return;

    setState((s) => ({ ...s, isAuthenticating: true }));

    try {
      // 1. Request nonce
      const nonceRes = await fetch(`${API_BASE}/auth/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ walletAddress: address }),
      });

      if (!nonceRes.ok) {
        throw new Error("Failed to get nonce");
      }

      const { nonce } = await nonceRes.json();

      // 2. Build and sign the message
      const message = `Sign in to Fortress\n\nNonce: ${nonce}\nAddress: ${address}`;
      const signature = await signMessageAsync({ message });

      // 3. Verify with backend
      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ walletAddress: address, signature }),
      });

      if (!verifyRes.ok) {
        throw new Error("Verification failed");
      }

      const data = await verifyRes.json();
      setState({
        isAuthenticated: true,
        isAuthenticating: false,
        walletAddress: data.walletAddress,
      });
    } catch {
      setState((s) => ({ ...s, isAuthenticating: false }));
    }
  }, [address, signMessageAsync]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors on logout
    }
    setState({
      isAuthenticated: false,
      isAuthenticating: false,
      walletAddress: null,
    });
  }, []);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Auto-detect wallet change and clear auth
  useEffect(() => {
    if (prevAddressRef.current && address !== prevAddressRef.current) {
      // Wallet changed, clear auth
      logout();
    }
    prevAddressRef.current = address;
  }, [address, logout]);

  // Clear auth if wallet disconnects
  useEffect(() => {
    if (!isConnected && state.isAuthenticated) {
      logout();
    }
  }, [isConnected, state.isAuthenticated, logout]);

  return {
    ...state,
    login,
    logout,
    checkAuth,
  };
}
