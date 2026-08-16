// Seeds the in-memory chain + capability registry with the real Base config used
// in production (src/boot.ts). The registry is module-global singleton state, so
// seeding is idempotent and safe to call from many test files.
import {
  registerChain,
  getChainByKey,
  registerCapabilities,
  getCapabilities,
} from "@core/registry/index.js";
import type { ChainInfo, Capability } from "@core/registry/index.js";
import { TOKENS, TOKEN_DECIMALS, MARKETS } from "../datasets/base.js";

const BASE_CHAIN: ChainInfo = {
  chainKey: "base",
  chainId: 8453,
  vm: "evm",
  label: "Base",
  executable: true,
  loanToken: "USDC",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: TOKENS.USDC, decimals: 6, stable: true, inputEnabled: true },
    { symbol: "USDbC", name: "USD Base Coin", address: TOKENS.USDbC, decimals: 6, stable: true },
    { symbol: "WETH", name: "Wrapped Ether", address: TOKENS.WETH, decimals: 18 },
    { symbol: "cbETH", name: "Coinbase Wrapped Staked ETH", address: TOKENS.cbETH, decimals: 18 },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: TOKENS.cbBTC, decimals: 8 },
    { symbol: "wstETH", name: "Wrapped Staked ETH", address: TOKENS.wstETH, decimals: 18 },
    { symbol: "weETH", name: "Wrapped eETH", address: TOKENS.weETH, decimals: 18 },
    { symbol: "ezETH", name: "Renzo Restaked ETH", address: TOKENS.ezETH, decimals: 18 },
    { symbol: "DAI", name: "Dai Stablecoin", address: TOKENS.DAI, decimals: 18, stable: true },
    { symbol: "EURC", name: "Euro Coin", address: TOKENS.EURC, decimals: 6, stable: true },
    { symbol: "AERO", name: "Aerodrome", address: TOKENS.AERO, decimals: 18 },
    { symbol: "DEGEN", name: "Degen", address: TOKENS.DEGEN, decimals: 18 },
  ],
  markets: MARKETS.map((m) => ({ ...m })),
};

const ETHEREUM_CHAIN: ChainInfo = {
  chainKey: "ethereum",
  chainId: 1,
  vm: "evm",
  label: "Ethereum",
  executable: false,
  loanToken: "USDC",
  tokens: [
    { symbol: "USDT", name: "Tether USD", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, stable: true },
  ],
  markets: [],
};

const CAPABILITIES: Capability[] = [
  { chainKey: "base", domain: "yield", protocol: "Morpho", actions: ["deposit", "withdraw", "leverage", "strategy", "exit"] },
  { chainKey: "base", domain: "yield", protocol: "Aave", actions: ["deposit", "withdraw"] },
  { chainKey: "base", domain: "yield", protocol: "Fluid", actions: ["deposit", "withdraw"] },
  { chainKey: "base", domain: "yield", protocol: "Euler", actions: ["deposit", "withdraw"] },
  { chainKey: "base", domain: "yield", protocol: "CompoundV3", actions: ["deposit", "withdraw"] },
  { chainKey: "base", domain: "yield", protocol: "Pendle", actions: ["deposit", "withdraw", "strategy"] },
  { chainKey: "base", domain: "yield", protocol: "LiFi", actions: ["swap", "bridge"] },
];

let seeded = false;

/** Idempotently register the Base/Ethereum chains and Base capabilities. */
export function seedRegistry(): void {
  if (!getChainByKey("base")) registerChain(BASE_CHAIN);
  if (!getChainByKey("ethereum")) registerChain(ETHEREUM_CHAIN);
  if (!seeded && getCapabilities({ chainKey: "base" }).length === 0) {
    registerCapabilities(CAPABILITIES);
  }
  seeded = true;
}
