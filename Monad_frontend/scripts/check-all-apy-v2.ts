/**
 * Live APY check — uses the EXACT same code paths the backend's APY poller uses
 * for each protocol. Tests every source: morpho-vault (GraphQL), aave-pool (ray),
 * erc4626-onchain (share growth), compound-comet (per-sec rate), pendle-implied (API).
 */
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { loadBaseConfig } from "../src/chains/evm/config/base.js";

const config = loadBaseConfig();
const client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
const SECONDS_PER_YEAR = 31_536_000;
const SAMPLE_BLOCKS = 302_400n;

// ── Morpho (GraphQL API) ────────────────────────────────────────────────────
async function morphoApy() {
  const vault = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca";
  const res = await fetch("https://blue-api.morpho.org/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{ vaultByAddress(address: "${vault}", chainId: 8453) { state { netApy } } }`,
    }),
  });
  const json = (await res.json()) as any;
  const netApy = json?.data?.vaultByAddress?.state?.netApy;
  console.log(`Morpho (mwUSDC):     APY = ${netApy != null ? (netApy * 100).toFixed(4) + "%" : "unavailable"} [source: morpho-vault GraphQL]`);
}

// ── Aave V3 (on-chain ray rate) ─────────────────────────────────────────────
async function aaveApy() {
  const AAVE_POOL = process.env.AAVE_POOL_BASE as `0x${string}`;
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
  const abi = [{ name: "getReserveData", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "data", type: "tuple", components: [{ name: "configuration", type: "uint256" },{ name: "liquidityIndex", type: "uint128" },{ name: "currentLiquidityRate", type: "uint128" },{ name: "variableBorrowIndex", type: "uint128" },{ name: "currentVariableBorrowRate", type: "uint128" },{ name: "currentStableBorrowRate", type: "uint128" },{ name: "lastUpdateTimestamp", type: "uint40" },{ name: "id", type: "uint16" },{ name: "aTokenAddress", type: "address" },{ name: "stableDebtTokenAddress", type: "address" },{ name: "variableDebtTokenAddress", type: "address" },{ name: "interestRateStrategyAddress", type: "address" },{ name: "accruedToTreasury", type: "uint128" },{ name: "unbacked", type: "uint128" },{ name: "isolationModeTotalDebt", type: "uint128" }] }] }] as const;
  const data = await client.readContract({ address: AAVE_POOL, abi, functionName: "getReserveData", args: [USDC] });
  const ray = data.currentLiquidityRate;
  const RAY = 10n ** 27n;
  const apr = Number(ray) / Number(RAY);
  const apy = Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
  console.log(`Aave V3 USDC:        APY = ${(apy * 100).toFixed(4)}% [source: aave-pool on-chain ray]`);
}

// ── Fluid (ERC-4626 on-chain share growth, 7d window) ────────────────────────
async function fluidApy() {
  const vault = "0xf42f5795d9ac7e9d757db633d693cd548cfd9169" as `0x${string}`;
  const abi = [{ name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
  const latest = await client.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await client.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  const ONE = 10n ** 12n; // safe for 6-decimal vaults
  const now = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE] });
  const past = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });
  if (past === 0n || now <= past) { console.log("Fluid (fUSDC):       no growth"); return; }
  const apy = (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
  console.log(`Fluid (fUSDC):       APY = ${(apy * 100).toFixed(4)}% [source: erc4626-onchain 7d]`);
}

// ── Euler (ERC-4626 on-chain share growth, 7d window) ────────────────────────
async function eulerApy() {
  const vault = "0x67f062a12f82c3b42d4ca7a35fb26cbaac28008b" as `0x${string}`;
  const abi = [{ name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;
  const latest = await client.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await client.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  const ONE = 10n ** 12n;
  const now = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE] });
  const past = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });
  if (past === 0n || now <= past) { console.log("Euler (eeUSDC):      no growth"); return; }
  const apy = (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
  console.log(`Euler (eeUSDC):      APY = ${(apy * 100).toFixed(4)}% [source: erc4626-onchain 7d]`);
}

// ── Compound V3 (on-chain per-second supply rate) ────────────────────────────
async function compoundApy() {
  const COMET = "0xb125E6687d4313864e53df431d5425969c15Eb2F" as `0x${string}`;
  const abi = [
    { name: "getUtilization", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
    { name: "getSupplyRate", type: "function", stateMutability: "view", inputs: [{ name: "utilization", type: "uint256" }], outputs: [{ type: "uint64" }] },
  ] as const;
  const util = await client.readContract({ address: COMET, abi, functionName: "getUtilization" });
  const rate = await client.readContract({ address: COMET, abi, functionName: "getSupplyRate", args: [util] });
  const perSec = Number(rate) / 1e18;
  const apy = Math.pow(1 + perSec, SECONDS_PER_YEAR) - 1;
  console.log(`Compound V3 USDC:    APY = ${(apy * 100).toFixed(4)}% [source: compound-comet on-chain]`);
}

// ── Pendle (implied APY from market API) ─────────────────────────────────────
async function pendleApy() {
  const pendle = config.protocols.find(p => p.name === "Pendle");
  const market = pendle?.defaultPendleMarket;
  if (!market) { console.log("Pendle: no default market"); return; }
  const res = await fetch(`https://api-v2.pendle.finance/core/v1/8453/markets/${market}`);
  if (!res.ok) { console.log(`Pendle: API ${res.status}`); return; }
  const json = (await res.json()) as { impliedApy?: number; name?: string };
  console.log(`Pendle (${json.name ?? "fixed yield"}): APY = ${((json.impliedApy ?? 0) * 100).toFixed(4)}% [source: pendle-implied API]`);
}

async function main() {
  console.log("=== Live APY — all protocols (real services) ===\n");
  await morphoApy();
  await aaveApy();
  await fluidApy();
  await eulerApy();
  await compoundApy();
  await pendleApy();
  console.log("\nDone.");
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
