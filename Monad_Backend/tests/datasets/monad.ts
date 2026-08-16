// Real Monad (chainId 143) constants used across the suite. Mirrors the chain
// registry seeded in src/boot.ts and the contract addresses in .env.example.
// Centralized here so tests never inline magic addresses.
//
// Every address is one that was verified against live Monad RPC — see
// Monad_Contract/Fortress/ADDRESSES.md. Nothing here is a Base address.

export const MONAD_CHAIN_ID = 143;
export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_CHAIN_KEY = "monad";

// Canonical Monad token addresses (checksummed, as registered in boot.ts).
export const TOKENS = {
  USDC: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
  WETH: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
  WBTC: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c",
  cbBTC: "0xd18B7EC58Cdf4876f6AFebd3Ed1730e4Ce10414b",
  USDT0: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D",
  AUSD: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a",
  shMON: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
} as const satisfies Record<string, `0x${string}`>;

export const TOKEN_DECIMALS = {
  USDC: 6,
  WMON: 18,
  WETH: 18,
  WBTC: 8,
  cbBTC: 8,
  USDT0: 6,
  AUSD: 6,
  shMON: 18,
} as const;

// Collateral/loan pairs used to exercise the strategy validator's market logic.
// Monad's live boot.ts registers `markets: []` — the Morpho leverage/exit
// executors that would trade against these are not deployed — so this is a
// fixture for the validator's rules, not a claim about registered markets.
// The tokens themselves are real Monad addresses.
export const MARKETS = [
  { label: "WETH-USDC", collateral: "WETH", loan: "USDC" },
  { label: "WBTC-USDC", collateral: "WBTC", loan: "USDC" },
  { label: "cbBTC-USDC", collateral: "cbBTC", loan: "USDC" },
  { label: "WMON-USDC", collateral: "WMON", loan: "USDC" },
  { label: "shMON-USDC", collateral: "shMON", loan: "USDC" },
] as const;

// Public Monad protocol/infra addresses (from .env.example; safe to hardcode).
export const CONTRACTS = {
  USDC: TOKENS.USDC,
  LIFI_DIAMOND: "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37",
  MORPHO_BLUE: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  PENDLE_ROUTER: "0x888888888889758F76e7103c6CbF23ABbF58F946",
  AAVE_POOL: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
  NEVERLAND_POOL: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585",
  FORT_VAULT: "0x252709C4569E096BD4babe3be9175Ca2F49f152F",
  FORT_SWAP_ROUTER: "0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0",
  CROSS_CHAIN_ROUTER: "0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE",
} as const satisfies Record<string, `0x${string}`>;

// Well-formed wallet addresses for request-shaping tests (not funded assumptions).
export const WALLETS = {
  // A vitalik-style address used purely as a syntactically valid recipient.
  sample: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  zero: "0x0000000000000000000000000000000000000000",
  // Reference wallet used by the strategy catalog for balance-dependent
  // sizing/simulation (core/services/strategies/catalog.ts PREVIEW_WALLET).
  preview: "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065",
} as const satisfies Record<string, `0x${string}`>;

// Amount helpers in smallest units.
export const ONE_USDC = 1_000_000n; // 6 decimals
export const ONE_MON = 1_000_000_000_000_000_000n; // 18 decimals
export const ONE_ETH = 1_000_000_000_000_000_000n; // 18 decimals
