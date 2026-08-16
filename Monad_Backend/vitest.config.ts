import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the TS path aliases (mirrors tsconfig.json "paths") so both the
// production source under src/ and the test tree under tests/ can use them.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const alias = {
  "@core": r("./src/core"),
  "@chains": r("./src/chains"),
  "@domains": r("./src/domains"),
  "@shared": r("./src/shared"),
  "@services": r("./src/services"),
};

// Deterministic env for the fast unit tier. Real-call tiers (integration,
// contracts, e2e, api) load the real .env via vitest.integration.config.ts.
export const deterministicEnv = {
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "gpt-4o",
  TENDERLY_ACCESS_KEY: "test-tenderly-key",
  TENDERLY_ACCOUNT_SLUG: "test-account",
  TENDERLY_PROJECT_SLUG: "test-project",
  RPC_BASE: "https://test.base.org",
  PORT: "3000",
};

export default defineConfig({
  resolve: { alias },
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    // Fast, deterministic tier: pure business logic, no network.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/property/**/*.test.ts",
      "tests/fuzz/**/*.test.ts",
      "tests/regression/**/*.test.ts",
      "tests/snapshots/**/*.test.ts",
      // Co-located tests that live next to source and stay deterministic.
      "src/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "dist/**", "Contracts/**", "frontend/**"],
    testTimeout: 30_000,
    env: deterministicEnv,
    reporters: ["default", "./tests/reporters/md-report.ts"],
  },
});
