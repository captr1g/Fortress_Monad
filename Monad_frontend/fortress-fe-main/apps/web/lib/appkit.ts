import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { monad, monadTestnet } from "@reown/appkit/networks";
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

  // The Reown/AppKit SDK makes two HTTP calls on init to validate the project
  // ID against api.web3modal.org. With the placeholder ID those calls return
  // 403, and the SDK's Analytics worker re-throws the error as an unhandled
  // rejection. In Next.js 16 Turbopack dev mode, any unhandled rejection
  // triggers the red error overlay — even when it comes from a third-party
  // SDK and is entirely non-blocking for the app.
  //
  // Intercept those specific rejections on the client so they stay as console
  // warnings and never reach Next.js's overlay handler.
  if (typeof window !== "undefined") {
    window.addEventListener("unhandledrejection", (event) => {
      const msg = event.reason?.message ?? String(event.reason ?? "");
      if (
        msg.includes("Failed to fetch") ||
        msg.includes("HTTP status code: 403") ||
        msg.includes("AnalyticsSDKApiError")
      ) {
        event.preventDefault(); // swallow — prevents Next.js overlay
      }
    });
  }
}

// Dedicated RPC transports for the Monad networks. Monad is the only chain
// the backend can execute on, so offering another network here would just let
// a user connect to a chain every plan will be rejected against.
const monadRpcUrl = process.env.NEXT_PUBLIC_MONAD_RPC_URL || "https://rpc.monad.xyz";
const monadTestnetRpcUrl = process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";

export const wagmiAdapter = new WagmiAdapter({
  networks: [monad, monadTestnet],
  projectId: effectiveProjectId,
  ssr: true,
  transports: {
    [monad.id]: http(monadRpcUrl),
    [monadTestnet.id]: http(monadTestnetRpcUrl),
  },
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: [monad, monadTestnet],
  defaultNetwork: monad,
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
