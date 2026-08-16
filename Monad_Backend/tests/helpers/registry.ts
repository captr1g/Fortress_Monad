// Seeds the in-memory chain + capability registry with the real Monad config
// used in production (src/boot.ts). The registry is module-global singleton
// state, so seeding is idempotent and safe to call from many test files.
import {
  registerChain,
  getChainByKey,
  registerCapabilities,
  getCapabilities,
} from "@core/registry/index.js";
import type { ChainInfo, Capability } from "@core/registry/index.js";
import { TOKENS, MARKETS, MONAD_CHAIN_ID } from "../datasets/monad.js";

const MONAD_CHAIN: ChainInfo = {
  chainKey: "monad",
  chainId: MONAD_CHAIN_ID,
  vm: "evm",
  label: "Monad",
  executable: true,
  loanToken: "USDC",
  tokens: [
    { symbol: "USDC", name: "USD Coin", address: TOKENS.USDC, decimals: 6, stable: true, inputEnabled: true },
    { symbol: "WMON", name: "Wrapped Monad", address: TOKENS.WMON, decimals: 18 },
    { symbol: "WETH", name: "Wrapped Ether", address: TOKENS.WETH, decimals: 18 },
    { symbol: "WBTC", name: "Wrapped Bitcoin", address: TOKENS.WBTC, decimals: 8 },
    { symbol: "cbBTC", name: "Coinbase Wrapped BTC", address: TOKENS.cbBTC, decimals: 8 },
    { symbol: "USDT0", name: "Tether USD (USDT0)", address: TOKENS.USDT0, decimals: 6, stable: true },
    { symbol: "AUSD", name: "Agora Dollar", address: TOKENS.AUSD, decimals: 6, stable: true },
    { symbol: "shMON", name: "FastLane Staked MON", address: TOKENS.shMON, decimals: 18 },
  ],
  // boot.ts registers `markets: []` on Monad. Seeded here anyway so the
  // strategy-validator tests have markets to validate against — see the note
  // on MARKETS in datasets/monad.ts.
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

// Mirrors boot.ts registerCapabilities, plus the Morpho leverage/strategy/exit
// actions. Those are NOT registered in production (their executors are not
// deployed on Monad), but the validator/refusal tests need a chain where they
// are supported in order to exercise the code paths at all.
const CAPABILITIES: Capability[] = [
  { chainKey: "monad", domain: "yield", protocol: "Aave", actions: ["deposit", "withdraw"] },
  { chainKey: "monad", domain: "yield", protocol: "Neverland", actions: ["deposit", "withdraw"] },
  { chainKey: "monad", domain: "yield", protocol: "Curvance", actions: ["deposit", "withdraw"] },
  { chainKey: "monad", domain: "yield", protocol: "Euler", actions: ["deposit", "withdraw"] },
  { chainKey: "monad", domain: "yield", protocol: "Morpho", actions: ["deposit", "withdraw", "leverage", "strategy", "exit"] },
  { chainKey: "monad", domain: "yield", protocol: "shMONAD", actions: ["deposit", "withdraw"] },
  { chainKey: "monad", domain: "yield", protocol: "LiFi", actions: ["swap", "bridge"] },
];

let seeded = false;

/** Idempotently register the Monad/Ethereum chains and Monad capabilities. */
export function seedRegistry(): void {
  if (!getChainByKey("monad")) registerChain(MONAD_CHAIN);
  if (!getChainByKey("ethereum")) registerChain(ETHEREUM_CHAIN);
  if (!seeded && getCapabilities({ chainKey: "monad" }).length === 0) {
    registerCapabilities(CAPABILITIES);
  }
  seeded = true;
}
