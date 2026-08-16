import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { base } from "@reown/appkit/networks";
import { http } from "wagmi";

// Reown AppKit (WalletConnect) + wagmi adapter. Wallet-only — no email/socials,
// since auth is SIWE against our backend (see packages/core/api).
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// createAppKit MUST always be called — useAppKit() and other hooks depend on
// the singleton it creates. A missing project ID means wallet-connect won't
// reach WalletConnect relay servers, but the app and all other hooks still work.
// Use a placeholder so the call always succeeds; swap it for a real ID from
// https://dashboard.reown.com in fortress-main/apps/web/.env.local.
const effectiveProjectId = projectId || "00000000000000000000000000000000";

if (!projectId) {
  console.warn(
    "[Fortress] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set.\n" +
    "Get a free project ID at https://dashboard.reown.com and add it to\n" +
    "fortress-main/apps/web/.env.local — wallet connection will not work without it.",
  );
}

// Pin an explicit Base RPC transport. Without this, the adapter routes reads and
// transaction preparation (nonce/gas/chainId) through WalletConnect's RPC
// (rpc.walletconnect.org), which is projectId-gated and rate-limited — it 401s
// and leaves viem unable to populate the tx, surfacing as `chain: undefined` and
// a malformed raw tx the node rejects ("transaction could not be decoded").
// Override with NEXT_PUBLIC_BASE_RPC_URL (a dedicated provider is recommended for
// production); the public endpoint is a safe default for reads + tx prep.
const baseRpcUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";

export const wagmiAdapter = new WagmiAdapter({
  networks: [base],
  projectId: effectiveProjectId,
  ssr: true,
  transports: {
    [base.id]: http(baseRpcUrl),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [base],
  projectId: effectiveProjectId,
  // Coinbase Wallet SDK's own telemetry beacon (cca-lite.coinbase.com) is
  // independent of `features.analytics` below and hangs when blocked by an
  // ad-blocker/privacy browser, stalling the whole tx-signing flow. We only
  // offer injected/WalletConnect wallets per the product spec anyway, so
  // just don't load the Coinbase connector at all.
  enableCoinbase: false,
  metadata: {
    name: "Fortress",
    description: "Autonomous DeFi strategies",
    // Reflects the actual browser origin so WalletConnect/Reown always sees
    // the domain the user is really on — this file is a client module but
    // still runs during SSR, where `window` isn't available yet.
    url: typeof window !== "undefined" ? window.location.origin : "https://app.fortress.exchange",
    icons: [],
  },
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": "#10b981",
    "--w3m-font-family": "var(--font-inter), system-ui, sans-serif",
    "--w3m-border-radius-master": "2px",
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
