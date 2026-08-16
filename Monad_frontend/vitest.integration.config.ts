import { defineConfig } from "vitest/config";
import { config as loadDotenv } from "dotenv";
import { alias } from "./vitest.config.js";

// Real-call tier. Loads the actual .env (real OpenAI/Tenderly/RPC/LiFi/DB/Redis
// credentials) so integration, contract, api, and e2e tests hit real services.
// Business logic is NEVER mocked; only determinism-sensitive spots (e.g. the LLM
// planner in a few API tests) may be stubbed, and those are the exception.
//
// Gated by RUN_INTEGRATION=1 so the default `npm test` stays fast and offline.
loadDotenv();

export default defineConfig({
  resolve: { alias },
  test: {
    name: "integration",
    globals: true,
    environment: "node",
    include: [
      "tests/integration/**/*.test.ts",
      "tests/contracts/**/*.test.ts",
      "tests/api/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "dist/**", "Contracts/**", "frontend/**"],
    // Real network round-trips (LLM, simulation, RPC, DB) need generous budgets.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Real external services rate-limit; keep concurrency low and deterministic.
    fileParallelism: false,
    retry: process.env.CI ? 2 : 0,
    reporters: ["default", "./tests/reporters/md-report.ts"],
  },
});
