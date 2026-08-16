import { defineConfig } from "vitest/config";

// Frontend test tier. Pure logic only — no browser, no wallet, no network —
// so it stays fast enough to run on every commit.
//
// apps/mobile/__tests__ is NOT included. It imports
// @walletconnect/react-native-compat, which ships untranspiled TypeScript
// under node_modules and needs a React Native transform vitest doesn't have
// here ("Stripping types is currently unsupported for files under
// node_modules"). That test predates this config and has never actually run —
// vitest wasn't even a dependency. Wiring an RN-capable runner for it is its
// own task; pretending it passes by leaving it in a failing suite is worse.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
