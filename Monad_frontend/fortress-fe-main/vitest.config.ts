import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 30_000,
    env: {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-4o",
      TENDERLY_ACCESS_KEY: "test-tenderly-key",
      TENDERLY_ACCOUNT_SLUG: "test-account",
      TENDERLY_PROJECT_SLUG: "test-project",
      RPC_BASE: "https://test.base.org",
      PORT: "3000",
    },
  },
});
//Now we need to shift this to a production grade codebase and the point is to get this system production ready so that it can do anything... 