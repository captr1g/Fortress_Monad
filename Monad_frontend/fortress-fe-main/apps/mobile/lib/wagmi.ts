import "./polyfills";

import { createAppKit } from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import { base } from "wagmi/chains";
import { asyncStorageAdapter } from "./asyncStorageAdapter";

// Reown AppKit (WalletConnect) + wagmi adapter — RN counterpart of
// apps/web/lib/appkit.ts. Wallet-only (no email/socials); auth is SIWE
// against our backend (see packages/core/api), same as web.
const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

// createAppKit MUST always be called — AppKit's hooks/modal depend on the
// singleton it creates. A missing project ID means wallet-connect won't
// reach WalletConnect relay servers, but the rest of the app still works.
const effectiveProjectId = projectId || "00000000000000000000000000000000";

if (!projectId) {
  console.warn(
    "[Fortress] EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID is not set.\n" +
      "Get a free project ID at https://dashboard.reown.com and add it to\n" +
      "apps/mobile/.env.local — wallet connection will not work without it.",
  );
}

export const wagmiAdapter = new WagmiAdapter({
  projectId: effectiveProjectId,
  networks: [base],
});

// Note: @reown/appkit-react-native and @reown/appkit-core-react-native each
// ship their own nested valtio copy — metro.config.js's resolver.extraNodeModules
// forces both onto one physical instance, or createAppKit throws inside
// AppKit.watchBalance() ("Cannot read properties of undefined").
export const appKit = createAppKit({
  projectId: effectiveProjectId,
  networks: [base],
  adapters: [wagmiAdapter],
  storage: asyncStorageAdapter,
  metadata: {
    name: "Fortress",
    description: "Autonomous DeFi strategies",
    url: "https://app.fortress.exchange",
    icons: [],
  },
  // Wallet-only, matching apps/web/lib/appkit.ts — CLAUDE.md: "No email/social
  // login, no embedded wallets." `socials` defaults to ON in this SDK if left
  // unset, which is why email/social options were showing up on mobile only.
  enableAnalytics: false,
  features: {
    socials: false,
    swaps: false,
    onramp: false,
  },
});

export const wagmiConfig = wagmiAdapter.wagmiConfig;
