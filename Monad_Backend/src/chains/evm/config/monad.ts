// Monad mainnet (chainId 143) contract addresses and protocol registry.
// To register another chain add {chain}.ts alongside this file.
//
// Every address here is either a FORTRESS deployment
// (Monad_Contract/Fortress/DEPLOYMENT.md) or a third-party address verified
// against live RPC in Monad_Contract/Fortress/ADDRESSES.md. Nothing was
// carried over from the Base deployment.

import { keccak256, toBytes } from "viem";
import type { EvmChainConfig, ProtocolEntry } from "../types.js";
import type { Address } from "viem";

function protocolKey(name: string): Address {
  return keccak256(toBytes(name));
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export const MONAD_CHAIN_ID = 143;
export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_DEFAULT_RPC = "https://rpc.monad.xyz";

/** Native-MON sentinel — FORTRESS's marker for "native MON, not an ERC-20". */
export const MONAD_NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;

export function loadMonadConfig(): EvmChainConfig {
  // ── FORTRESS deployments (DEPLOYMENT.md §1) ────────────────────────────────
  const vault = (process.env.FORTRESS_VAULT ||
    "0x252709C4569E096BD4babe3be9175Ca2F49f152F") as Address;
  const swapRouter = (process.env.FORTRESS_SWAP_ROUTER ||
    "0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0") as Address;
  const crossChainRouter = (process.env.FORTRESS_CROSS_CHAIN_ROUTER ||
    "0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE") as Address;

  // ── Third-party, verified on Monad mainnet (ADDRESSES.md) ─────────────────
  const usdc = (process.env.FORTRESS_USDC ||
    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603") as Address;
  const lifiDiamond = (process.env.FORTRESS_LIFI_DIAMOND ||
    "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37") as Address;
  const morphoBlue = (process.env.FORTRESS_MORPHO_BLUE ||
    "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee") as Address;
  const pendleRouter = (process.env.FORTRESS_PENDLE_ROUTER ||
    "0x888888888889758F76e7103c6CbF23ABbF58F946") as Address;

  // ── Not yet deployed on Monad ─────────────────────────────────────────────
  // FortStrategyExecutor, MorphoExitExecutor, MorphoLeverageExecutor,
  // MorphoStrategyAdapter, SwapStrategyAdapter and PendleAdapter exist in
  // Monad_Contract/Fortress/src but are NOT in the mainnet deployment. They
  // default to the zero address, and boot.ts leaves the matching capabilities
  // ("strategy", "leverage", "exit") unregistered so the planner refuses them
  // cleanly instead of emitting calldata that would revert. Set these env vars
  // and add the capability once the executors are deployed.
  const strategyExecutor = (process.env.FORTRESS_STRATEGY_EXECUTOR || ZERO_ADDRESS) as Address;
  const morphoExitExecutor = (process.env.FORTRESS_MORPHO_EXIT_EXECUTOR || ZERO_ADDRESS) as Address;
  const morphoLeverageExecutor = (process.env.FORTRESS_MORPHO_LEVERAGE_EXECUTOR || ZERO_ADDRESS) as Address;
  const morphoAdapter = (process.env.FORTRESS_MORPHO_ADAPTER || ZERO_ADDRESS) as Address;
  const swapAdapter = (process.env.FORTRESS_SWAP_ADAPTER || ZERO_ADDRESS) as Address;
  const pendleAdapter = (process.env.FORTRESS_PENDLE_ADAPTER || ZERO_ADDRESS) as Address;

  // Aerodrome is Base-only and has no Monad deployment. The field stays on
  // EvmChainConfig so the (now inert) Aerodrome code paths still typecheck.
  const aerodromeRouter = ZERO_ADDRESS;

  const chainId = Number(process.env.FORTRESS_CHAIN_ID) || MONAD_CHAIN_ID;
  const rpcUrl = process.env.RPC_MONAD || MONAD_DEFAULT_RPC;
  const lifiApiKey = process.env.LIFI_API_KEY ?? "";

  // This list must mirror FortVault's on-chain registry exactly — `name` is
  // hashed to the registry key (keccak256 of the string passed to
  // registerProtocol), and invariants.ts fails startup on any drift between
  // `address`/`isERC4626` here and what the vault actually holds.
  const protocols: ProtocolEntry[] = [
    {
      name: "Aave",
      displayName: "Aave V3 (Monad)",
      key: protocolKey("Aave"),
      // aTokens rebase and Aave's asset()/totalAssets()/maxDeposit() all revert,
      // so this goes through AaveV3Adapter rather than the ERC-4626 fast path.
      isERC4626: false,
      address: "0x1493522095857A3e28e6573E8a1f6b612dd30B40",
      apySource: "aave-pool",
      aavePool: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
      // aMonUSDC — 1:1 USDC-denominated, so withdraw "shares" are USDC units.
      positionToken: "0x35a73BAcb179d3740395A3ceCc87FF2e581d6042",
      vaultSymbol: "aMonUSDC",
      aliases: ["Aave V3", "AaveV3", "Aave Monad"],
    },
    {
      name: "Neverland",
      displayName: "Neverland (Aave V3 fork)",
      key: protocolKey("Neverland"),
      isERC4626: false,
      address: "0x34bce6998d3599B665Ec36b205ab1d91F23f2b4D",
      apySource: "aave-pool",
      aavePool: "0x80F00661b13CC5F6ccd3885bE7b4C9c67545D585",
      positionToken: "0x38648958836eA88b368b4ac23b86Ad44B0fe7508",
      vaultSymbol: "nUSDC",
      aliases: ["Neverland Market", "Neverland V3"],
    },
    {
      name: "Curvance",
      displayName: "Curvance (cUSDC)",
      key: protocolKey("Curvance"),
      isERC4626: true,
      address: "0x21aDBb60a5fB909e7F1fB48aACC4569615CD97b5",
      apySource: "erc4626-onchain",
      vaultSymbol: "cUSDC",
    },
    {
      name: "Euler",
      displayName: "Euler (eUSDC)",
      key: protocolKey("Euler"),
      isERC4626: true,
      address: "0x1905EDDF5943ef6C92Ccf1469bd40fC2cB4A77b0",
      apySource: "erc4626-onchain",
      vaultSymbol: "eUSDC",
    },
    {
      name: "Morpho",
      displayName: "Morpho (Hyperithm USDC Apex)",
      key: protocolKey("Morpho"),
      isERC4626: true,
      // MetaMorpho V2 vault, asset() == USDC. Registered deliberately while at
      // cap (maxDeposit() == 0) — FortVault's capacity guard turns a deposit
      // into a clean ProtocolAtCapacity revert, and it starts accepting
      // deposits the moment the curator raises the cap (DeployMonad.s.sol).
      address: "0x78999cc96d2Ba0341588C60CcB0E91c6C33CF371",
      apySource: "erc4626-onchain",
      vaultSymbol: "Hyperithm USDC Apex",
    },
    {
      name: "shMONAD",
      displayName: "shMONAD (FastLane liquid staking)",
      key: protocolKey("shMONAD"),
      isERC4626: false,
      address: "0x6f9eDe63115707bF01403f12f63Fa5e4616BB47A",
      apySource: "none",
      // FastLane shMONAD. Exits carry a real 64 bps haircut — size any minimum
      // off previewRedeem / ShMonadAdapter.previewRedeemMon, never off
      // convertToAssets (ADDRESSES.md §5.5.1).
      positionToken: "0x1B68626dCa36c7fE922fD2d55E4f631d962dE19c",
      vaultSymbol: "shMON",
      aliases: ["shMON", "FastLane", "Shmonad"],
    },
    {
      name: "LiFi",
      key: protocolKey("LiFi"),
      isERC4626: false,
      address: "0x1f2Bda259365BF10210AB6C8C0F4A211eE2be5FC",
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
    chainKey: "monad",
    rpcUrl,
    lifiApiKey,
    protocols,
  };
}
