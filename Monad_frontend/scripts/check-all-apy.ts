/**
 * Check APY for all protocols using the SAME code paths as the backend.
 * Morpho (ERC-4626 share growth), Aave (ray rate), Compound (per-sec rate), Pendle (implied APY API).
 */
import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { loadBaseConfig } from "../src/chains/evm/config/base.js";

const config = loadBaseConfig();
const rpcUrl = config.rpcUrl;
const client = createPublicClient({ chain: base, transport: http(rpcUrl) });

const SECONDS_PER_YEAR = 31_536_000;
const SAMPLE_BLOCKS = 302_400n; // ~7 days

const erc4626Abi = [
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const aavePoolAbi = [
  { name: "getReserveData", type: "function", stateMutability: "view", inputs: [{ name: "asset", type: "address" }], outputs: [{ name: "data", type: "tuple", components: [{ name: "configuration", type: "uint256" },{ name: "liquidityIndex", type: "uint128" },{ name: "currentLiquidityRate", type: "uint128" },{ name: "variableBorrowIndex", type: "uint128" },{ name: "currentVariableBorrowRate", type: "uint128" },{ name: "currentStableBorrowRate", type: "uint128" },{ name: "lastUpdateTimestamp", type: "uint40" },{ name: "id", type: "uint16" },{ name: "aTokenAddress", type: "address" },{ name: "stableDebtTokenAddress", type: "address" },{ name: "variableDebtTokenAddress", type: "address" },{ name: "interestRateStrategyAddress", type: "address" },{ name: "accruedToTreasury", type: "uint128" },{ name: "unbacked", type: "uint128" },{ name: "isolationModeTotalDebt", type: "uint128" }] }] },
] as const;

const cometAbi = [
  { name: "getUtilization", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getSupplyRate", type: "function", stateMutability: "view", inputs: [{ name: "utilization", type: "uint256" }], outputs: [{ type: "uint64" }] },
] as const;

async function erc4626Apy(name: string, vault: `0x${string}`) {
  const latest = await client.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await client.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  const ONE = 10n ** 12n;
  const now = await client.readContract({ address: vault, abi: erc4626Abi, functionName: "convertToAssets", args: [ONE] });
  const past = await client.readContract({ address: vault, abi: erc4626Abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });
  if (past === 0n || now <= past) { console.log(`${name}: no growth (now=${now} past=${past})`); return; }
  const apy = (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
  console.log(`${name}: APY = ${(apy * 100).toFixed(4)}% (7d share growth)`);
}

async function aaveApy() {
  const AAVE_POOL = process.env.AAVE_POOL_BASE as `0x${string}`;
  const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`;
  const data = await client.readContract({ address: AAVE_POOL, abi: aavePoolAbi, functionName: "getReserveData", args: [USDC] });
  const ray = data.currentLiquidityRate;
  const RAY = 10n ** 27n;
  const apr = Number(ray) / Number(RAY);
  const apy = Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;
  console.log(`Aave V3 USDC: APY = ${(apy * 100).toFixed(4)}% (ray=${ray.toString()})`);
}

async function compoundApy() {
  const COMET = "0xb125E6687d4313864e53df431d5425969c15Eb2F" as `0x${string}`;
  const util = await client.readContract({ address: COMET, abi: cometAbi, functionName: "getUtilization" });
  const rate = await client.readContract({ address: COMET, abi: cometAbi, functionName: "getSupplyRate", args: [util] });
  const perSec = Number(rate) / 1e18;
  const apy = Math.pow(1 + perSec, SECONDS_PER_YEAR) - 1;
  console.log(`Compound V3 USDC: APY = ${(apy * 100).toFixed(4)}% (util=${(Number(util)/1e18*100).toFixed(1)}%)`);
}

async function pendleApy() {
  const pendle = config.protocols.find(p => p.name === "Pendle");
  const market = pendle?.defaultPendleMarket;
  if (!market) { console.log("Pendle: no default market configured"); return; }
  const res = await fetch(`https://api-v2.pendle.finance/core/v1/8453/markets/${market}`);
  if (!res.ok) { console.log(`Pendle: API ${res.status}`); return; }
  const json = (await res.json()) as { impliedApy?: number; name?: string };
  console.log(`Pendle (${json.name ?? market}): implied APY = ${((json.impliedApy ?? 0) * 100).toFixed(4)}%`);
}

async function main() {
  console.log("=== Live APY check (all protocols) ===\n");

  // Morpho (mwUSDC — Moonwell Flagship USDC)
  await erc4626Apy("Morpho (mwUSDC)", "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca");

  // Aave V3
  await aaveApy();

  // Compound V3
  await compoundApy();

  // Pendle (implied fixed yield)
  await pendleApy();

  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
