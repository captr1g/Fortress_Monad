// Base chain (chainId 8453) contract addresses and protocol registry.
// To register new chain add another {chain}.ts

import { keccak256, toBytes } from "viem";
import type { EvmChainConfig, ProtocolEntry } from "../types.js";
import type { Address } from "viem";

function protocolKey(name: string): Address {
  return keccak256(toBytes(name));
}

export function loadBaseConfig(): EvmChainConfig {
  const vault = process.env.FORTRESS_VAULT as Address;
  const swapRouter = process.env.FORTRESS_SWAP_ROUTER as Address;
  const crossChainRouter = process.env
    .FORTRESS_CROSS_CHAIN_ROUTER as Address;
  const usdc = process.env.FORTRESS_USDC as Address;
  const lifiDiamond = process.env.FORTRESS_LIFI_DIAMOND as Address;
  const strategyExecutor = process.env
    .FORTRESS_STRATEGY_EXECUTOR as Address;
  const morphoExitExecutor = process.env
    .FORTRESS_MORPHO_EXIT_EXECUTOR as Address;
  const morphoLeverageExecutor = process.env
    .FORTRESS_MORPHO_LEVERAGE_EXECUTOR as Address;
  const morphoBlue = process.env.FORTRESS_MORPHO_BLUE as Address;
  const morphoAdapter = process.env.FORTRESS_MORPHO_ADAPTER as Address;
  const swapAdapter = process.env.FORTRESS_SWAP_ADAPTER as Address;
  const pendleRouter = process.env.FORTRESS_PENDLE_ROUTER as Address;
  const pendleAdapter = process.env.FORTRESS_PENDLE_ADAPTER as Address;
  const aerodromeRouter = (process.env.FORTRESS_AERODROME_ROUTER ?? "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43") as Address;
  const chainId = Number(process.env.FORTRESS_CHAIN_ID) || 8453;
  const rpcUrl = process.env.RPC_BASE as string;
  const lifiApiKey = process.env.LIFI_API_KEY ?? "";

  const protocols: ProtocolEntry[] = [
    {
      name: "Morpho",
      key: protocolKey("Morpho"),
      isERC4626: true,
      address: "0xbeef0e0834849aCC03f0089F01f4F1Eeb06873C9", // Steakhouse Prime USDC V2
      apySource: "erc4626-onchain",
    },
    {
      name: "Aave",
      key: protocolKey("Aave"),
      isERC4626: true,
      address: "0xC768c589647798a6EE01A91FdE98EF2ed046DBD6",
      apySource: "aave-pool",
      vaultSymbol: "waBasUSDC",
    },
    {
      name: "Fluid",
      key: protocolKey("Fluid"),
      isERC4626: true,
      address: "0xf42f5795D9ac7e9D757dB633D693cD548Cfd9169",
      apySource: "erc4626-onchain",
      vaultSymbol: "fUSDC",
    },
    {
      name: "Euler",
      key: protocolKey("Euler"),
      isERC4626: true,
      // Verified on-chain: symbol() = "CSEUSDC", name() = "Clearstar Earn
      // USDC" — swapped in by a teammate (commit 63b0211) after the prior
      // vault this pointed at was deprecated by Euler for low activity.
      // vaultSymbol below must track whatever this address actually is.
      address: "0x8bF41Ad2b816F7c220b22F4BCD63fC2A35Ab4247",
      apySource: "erc4626-onchain",
      vaultSymbol: "CSEUSDC",
    },
    {
      name: "CompoundV3",
      key: protocolKey("CompoundV3"),
      isERC4626: false,
      // Must match the adapter actually registered on FortVault under the
      // keccak256("CompoundV3") key. Verified on-chain via
      //   FortVault.protocols(keccak256("CompoundV3")) => this address.
      // The older 0xC161A7A5… adapter (from DeployNewProtocols) is NOT the
      // one the live vault routes through, so `comet.allow(address,…)` must
      // authorise THIS adapter or withdrawFrom reverts (Unauthorized).
      address: "0xDbE2D6C69b3e219aA67fC1eeEb93A88cAC59AfdA",
      apySource: "compound-comet",
      positionToken: "0xb125E6687d4313864e53df431d5425969c15Eb2F",
      vaultSymbol: "cUSDCv3",
      // The planner (and any user) naturally says "Compound", not the
      // registry's versioned key — see resolveProtocolEntry in types.ts.
      aliases: ["Compound", "Compound Finance", "Compound V3", "Comp"],
    },
    {
      name: "Pendle",
      displayName: "Pendle (fixed yield)",
      key: protocolKey("Pendle"),
      isERC4626: false,
      address: "0x9124140ecD249fAde22068578B64fCF19C400082",
      apySource: "pendle-implied",
      pendleVaultMarkets: [
        {
          label: "40acresUSDC",
          market: "0x87e9a352d50146fa03373c52b9b21a32402a9597",
        },
        {
          label: "yoUSD",
          market: "0x250c15e59a7572195e248f668636723cca20a2b8",
        },
        {
          label: "USDC-cbBTC",
          market: "0xa97bb0de338b23c088dba9bf8c948da726e49033",
        },
      ],
      defaultPendleMarket: "0x87e9a352d50146fa03373c52b9b21a32402a9597",
    },
    {
      name: "Yo",
      displayName: "Yo Protocol (yoUSD)",
      key: protocolKey("Yo"),
      isERC4626: false,
      address: process.env.FORTRESS_YO_ADAPTER as Address ?? "0x0000000000000000000000000000000000000000" as Address,
      apySource: "erc4626-onchain",
      positionToken: "0x0000000f2eB9f69274678c76222B35eEc7588a65" as Address,
      vaultSymbol: "yoUSD",
      aliases: ["Yo Protocol", "yoUSD", "YO", "yo.xyz"],
    },
    {
      name: "Aerodrome",
      displayName: "Aerodrome LP",
      key: protocolKey("Aerodrome"),
      isERC4626: false,
      address: process.env.FORTRESS_AERODROME_ADAPTER as Address ?? "0x0000000000000000000000000000000000000000" as Address,
      apySource: "aerodrome-gauge",
      // Default gauge is USDC-AERO — the positionToken for balance reads.
      positionToken: "0x4F09bAb2f0E15e2A078A227FE1537665F55b8360" as Address,
      vaultSymbol: "aeroLP",
      aliases: ["Aero", "Aerodrome Finance", "AERO LP", "Aerodrome DEX"],
      defaultAerodromePool: "USDC-AERO",
      aerodromePools: [
        {
          label: "USDC-AERO",
          poolKey: protocolKey("USDC-AERO"),
          pool: "0x6cDcb1C4A4D1C3C6d054b27AC5B77e89eAFb971d" as Address,
          gauge: "0x4F09bAb2f0E15e2A078A227FE1537665F55b8360" as Address,
          pairedToken: "0x940181a94A35A4569E4529A3CDfB74e38FD98631" as Address,
          stable: false,
        },
        {
          label: "USDC-WETH",
          poolKey: protocolKey("USDC-WETH"),
          pool: "0xcDAC0d6c6C59727a65F871236188350531885C43" as Address,
          gauge: "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025" as Address,
          pairedToken: "0x4200000000000000000000000000000000000006" as Address,
          stable: false,
        },
      ],
    },
    {
      name: "LiFi",
      key: protocolKey("LiFi"),
      isERC4626: false,
      address: "0x0Be179f37e696556874fcF0147b8A9Be72740ADa",
      apySource: "none",
    },
  ];

  return {
    vault,
    swapRouter,
    crossChainRouter,
    usdc,
    lifiDiamond,
    strategyExecutor,
    morphoExitExecutor,
    morphoLeverageExecutor,
    morphoBlue,
    morphoAdapter,
    swapAdapter,
    pendleRouter,
    pendleAdapter,
    aerodromeRouter,
    chainId,
    chainKey: "base",
    rpcUrl,
    lifiApiKey,
    protocols,
  };
}
