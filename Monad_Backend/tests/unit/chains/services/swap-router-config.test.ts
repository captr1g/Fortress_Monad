import { describe, it, expect, beforeAll } from "vitest";

// Verifies that the EvmChainConfig type includes swapRouter and that the
// loadMonadConfig function reads it from the environment.

describe("EvmChainConfig — swapRouter field", () => {
  beforeAll(() => {
    // Set minimal env vars needed for loadMonadConfig
    process.env.FORTRESS_VAULT = "0x0000000000000000000000000000000000000001";
    process.env.FORTRESS_SWAP_ROUTER = "0x0000000000000000000000000000000000000002";
    process.env.FORTRESS_CROSS_CHAIN_ROUTER = "0x0000000000000000000000000000000000000003";
    process.env.FORTRESS_USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
    process.env.FORTRESS_LIFI_DIAMOND = "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37";
    process.env.FORTRESS_STRATEGY_EXECUTOR = "0x0000000000000000000000000000000000000004";
    process.env.FORTRESS_MORPHO_EXIT_EXECUTOR = "0x0000000000000000000000000000000000000005";
    process.env.FORTRESS_MORPHO_LEVERAGE_EXECUTOR = "0x0000000000000000000000000000000000000006";
    process.env.FORTRESS_MORPHO_BLUE = "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee";
    process.env.FORTRESS_MORPHO_ADAPTER = "0x0000000000000000000000000000000000000007";
    process.env.FORTRESS_SWAP_ADAPTER = "0x0000000000000000000000000000000000000008";
    process.env.FORTRESS_PENDLE_ROUTER = "0x888888888889758F76e7103c6CbF23ABbF58F946";
    process.env.FORTRESS_PENDLE_ADAPTER = "0x0000000000000000000000000000000000000009";
    process.env.FORTRESS_CHAIN_ID = "143";
    process.env.RPC_MONAD = "http://127.0.0.1:8545";
    process.env.LIFI_API_KEY = "";
  });

  it("loadMonadConfig includes swapRouter from env", async () => {
    const { loadMonadConfig } = await import("@chains/evm/config/monad.js");
    const config = loadMonadConfig();
    expect(config.swapRouter).toBe("0x0000000000000000000000000000000000000002");
  });

  it("swapRouter is distinct from vault address", async () => {
    const { loadMonadConfig } = await import("@chains/evm/config/monad.js");
    const config = loadMonadConfig();
    expect(config.swapRouter).not.toBe(config.vault);
  });

  it("config has all required fields for the new contract layout", async () => {
    const { loadMonadConfig } = await import("@chains/evm/config/monad.js");
    const config = loadMonadConfig();
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

  it("targets Monad, never Base", async () => {
    const { loadMonadConfig } = await import("@chains/evm/config/monad.js");
    const config = loadMonadConfig();
    expect(config.chainKey).toBe("monad");
    expect(config.chainId).toBe(143);
    expect(config.rpcUrl).not.toMatch(/base/i);
  });
});
