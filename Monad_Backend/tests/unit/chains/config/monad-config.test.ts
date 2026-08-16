import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MONAD_CHAIN_ID, MONAD_TESTNET_CHAIN_ID } from "../../../datasets/monad.js";

// Guards the class of bug that shipped a transaction approving Base USDC on
// Monad: a config that is internally inconsistent, or that still carries an
// address from the chain FORTRESS migrated off.
//
// verifyChainIdentity() in invariants.ts is the runtime half of this and asks
// the chain directly (eth_chainId + eth_getCode); it needs a live RPC, so it
// lives in the integration tier. This tier catches the same mistake offline,
// on every commit.

// Addresses that were in the Base deployment. None has code on Monad — probed
// live via eth_getCode, all returned "0x".
const BASE_ADDRESSES = [
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC (Base)
  "0x4200000000000000000000000000000000000006", // WETH (Base predeploy)
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca", // USDbC
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", // cbETH
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", // cbBTC (Base)
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae", // LI.FI diamond (Base)
  "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb", // Morpho Blue (Base)
  "0xa238dd80c259a72e81d7e4664a9801593f98d1c5", // Aave V3 Pool (Base)
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631", // AERO
];

// The env is process-global and monad.ts reads it at call time, so anything a
// developer happens to have exported must not leak into these assertions.
const CHAIN_ENV_KEYS = [
  "FORTRESS_CHAIN_ID", "FORTRESS_VAULT", "FORTRESS_SWAP_ROUTER",
  "FORTRESS_CROSS_CHAIN_ROUTER", "FORTRESS_USDC", "FORTRESS_LIFI_DIAMOND",
  "FORTRESS_MORPHO_BLUE", "FORTRESS_PENDLE_ROUTER", "RPC_MONAD",
];

describe("loadMonadConfig — chain consistency", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of CHAIN_ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function load() {
    const { loadMonadConfig } = await import("@chains/evm/config/monad.js");
    return loadMonadConfig();
  }

  it("defaults to Monad mainnet", async () => {
    const config = await load();
    expect(config.chainId).toBe(MONAD_CHAIN_ID);
    expect(config.chainKey).toBe("monad");
    expect(config.rpcUrl).toContain("monad");
  });

  it("carries no address from the Base deployment", async () => {
    const config = await load();
    const addresses = [
      config.vault, config.swapRouter, config.crossChainRouter, config.usdc,
      config.lifiDiamond, config.morphoBlue, config.pendleRouter,
      ...config.protocols.flatMap((p) => [p.address, p.positionToken, p.aavePool]),
    ]
      .filter(Boolean)
      .map((a) => (a as string).toLowerCase());

    for (const stale of BASE_ADDRESSES) {
      expect(addresses, `Base address ${stale} is still in the Monad config`).not.toContain(stale);
    }
  });

  it("registers every protocol the deployed FortVault holds", async () => {
    const config = await load();
    const names = config.protocols.map((p) => p.name).sort();
    // Mirrors DeployMonad.s.sol's registerProtocol() calls. `name` is hashed to
    // the on-chain registry key, so a rename here silently stops resolving.
    expect(names).toEqual(
      ["Aave", "Curvance", "Euler", "LiFi", "Morpho", "Neverland", "shMONAD"].sort(),
    );
  });

  it("gives every aave-pool protocol its own pool address", async () => {
    const config = await load();
    const aaveish = config.protocols.filter((p) => p.apySource === "aave-pool");
    expect(aaveish.length).toBeGreaterThan(1); // Aave V3 Monad + Neverland
    for (const p of aaveish) {
      expect(p.aavePool, `${p.name} has no aavePool`).toBeDefined();
    }
    // Two markets on one chain must not share a pool — that was the reason
    // the pool stopped being a module-level constant.
    const pools = new Set(aaveish.map((p) => p.aavePool));
    expect(pools.size).toBe(aaveish.length);
  });

  it("honours an explicit testnet chain id", async () => {
    process.env.FORTRESS_CHAIN_ID = String(MONAD_TESTNET_CHAIN_ID);
    const config = await load();
    expect(config.chainId).toBe(MONAD_TESTNET_CHAIN_ID);
  });
});
