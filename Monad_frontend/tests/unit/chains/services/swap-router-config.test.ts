import { describe, it, expect, beforeAll } from "vitest";

// Verifies that the EvmChainConfig type includes swapRouter and that the
// loadBaseConfig function reads it from the environment.

describe("EvmChainConfig — swapRouter field", () => {
  beforeAll(() => {
    // Set minimal env vars needed for loadBaseConfig
    process.env.FORTRESS_VAULT = "0x0000000000000000000000000000000000000001";
    process.env.FORTRESS_SWAP_ROUTER = "0x0000000000000000000000000000000000000002";
    process.env.FORTRESS_CROSS_CHAIN_ROUTER = "0x0000000000000000000000000000000000000003";
    process.env.FORTRESS_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    process.env.FORTRESS_LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
    process.env.FORTRESS_STRATEGY_EXECUTOR = "0x0000000000000000000000000000000000000004";
    process.env.FORTRESS_MORPHO_EXIT_EXECUTOR = "0x0000000000000000000000000000000000000005";
    process.env.FORTRESS_MORPHO_LEVERAGE_EXECUTOR = "0x0000000000000000000000000000000000000006";
    process.env.FORTRESS_MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";
    process.env.FORTRESS_MORPHO_ADAPTER = "0x0000000000000000000000000000000000000007";
    process.env.FORTRESS_SWAP_ADAPTER = "0x0000000000000000000000000000000000000008";
    process.env.FORTRESS_PENDLE_ROUTER = "0x888888888889758F76e7103c6CbF23ABbF58F946";
    process.env.FORTRESS_PENDLE_ADAPTER = "0x0000000000000000000000000000000000000009";
    process.env.FORTRESS_CHAIN_ID = "8453";
    process.env.RPC_BASE = "http://127.0.0.1:8545";
    process.env.LIFI_API_KEY = "";
  });

  it("loadBaseConfig includes swapRouter from env", async () => {
    const { loadBaseConfig } = await import("@chains/evm/config/base.js");
    const config = loadBaseConfig();
    expect(config.swapRouter).toBe("0x0000000000000000000000000000000000000002");
  });

  it("swapRouter is distinct from vault address", async () => {
    const { loadBaseConfig } = await import("@chains/evm/config/base.js");
    const config = loadBaseConfig();
    expect(config.swapRouter).not.toBe(config.vault);
  });

  it("config has all required fields for the new contract layout", async () => {
    const { loadBaseConfig } = await import("@chains/evm/config/base.js");
    const config = loadBaseConfig();
    expect(config.vault).toBeDefined();
    expect(config.swapRouter).toBeDefined();
    expect(config.crossChainRouter).toBeDefined();
    expect(config.strategyExecutor).toBeDefined();
    expect(config.morphoExitExecutor).toBeDefined();
    expect(config.morphoLeverageExecutor).toBeDefined();
    expect(config.morphoAdapter).toBeDefined();
    expect(config.swapAdapter).toBeDefined();
    expect(config.pendleAdapter).toBeDefined();
  });
});
