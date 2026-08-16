// Real Base (chainId 8453) constants used across the suite. Mirrors the chain
// registry seeded in src/boot.ts and the public contract addresses in .env.example.
// Centralized here so tests never inline magic addresses.

export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_KEY = "base";

// Canonical Base token addresses (checksummed, as registered in boot.ts).
export const TOKENS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  USDbC: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  WETH: "0x4200000000000000000000000000000000000006",
  cbETH: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
  cbBTC: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
  wstETH: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452",
  weETH: "0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A",
  ezETH: "0x2416092f143378750bb29b79eD961ab195CcEea5",
  DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  EURC: "0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42",
  AERO: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  DEGEN: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
} as const satisfies Record<string, `0x${string}`>;

export const TOKEN_DECIMALS = {
  USDC: 6,
  USDbC: 6,
  WETH: 18,
  cbETH: 18,
  cbBTC: 8,
  wstETH: 18,
  weETH: 18,
  ezETH: 18,
  DAI: 18,
  EURC: 6,
  AERO: 18,
  DEGEN: 18,
} as const;

// Morpho markets registered on Base (label -> collateral/loan).
export const MARKETS = [
  { label: "cbETH-USDC", collateral: "cbETH", loan: "USDC" },
  { label: "cbBTC-USDC", collateral: "cbBTC", loan: "USDC" },
  { label: "wstETH-USDC", collateral: "wstETH", loan: "USDC" },
  { label: "ezETH-USDC", collateral: "ezETH", loan: "USDC" },
  { label: "WETH-USDC", collateral: "WETH", loan: "USDC" },
] as const;

// Public Base protocol/infra addresses (from .env.example; safe to hardcode).
export const CONTRACTS = {
  USDC: TOKENS.USDC,
  LIFI_DIAMOND: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  MORPHO_BLUE: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  PENDLE_ROUTER: "0x888888888889758F76e7103c6CbF23ABbF58F946",
  AAVE_POOL: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
} as const satisfies Record<string, `0x${string}`>;

// Well-formed wallet addresses for request-shaping tests (not funded assumptions).
export const WALLETS = {
  // A vitalik-style address used purely as a syntactically valid recipient.
  sample: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  zero: "0x0000000000000000000000000000000000000000",
  // Funded Base reference wallet used by the strategy catalog for balance-dependent
  // sizing/simulation (core/services/strategies/catalog.ts PREVIEW_WALLET).
  preview: "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065",
} as const satisfies Record<string, `0x${string}`>;

// Amount helpers in smallest units.
export const ONE_USDC = 1_000_000n; // 6 decimals
export const ONE_ETH = 1_000_000_000_000_000_000n; // 18 decimals
