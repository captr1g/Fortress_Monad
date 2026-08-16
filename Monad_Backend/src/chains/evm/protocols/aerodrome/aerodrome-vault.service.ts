/** Builds deposit/redeem `data` params for the AerodromeAdapter on-chain contract. */

import { createPublicClient, http, encodeAbiParameters, encodeFunctionData, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { EvmChainConfig, AerodromePool } from "../../types.js";

const DEADLINE_SECONDS = 600; // 10 minutes
const SLIPPAGE_BPS = 50n;    // 0.5%

// ABI for Aerodrome Router getAmountsOut
const routerAbi = [
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

// Matches AerodromeAdapter.depositFor data encoding
const DEPOSIT_DATA_ABI = [
  { name: "poolKey", type: "bytes32" },
  { name: "minPairedOut", type: "uint256" },
  { name: "amountAMin", type: "uint256" },
  { name: "amountBMin", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

// Matches AerodromeAdapter.redeemFor data encoding
const REDEEM_DATA_ABI = [
  { name: "poolKey", type: "bytes32" },
  { name: "minAmountA", type: "uint256" },
  { name: "minAmountB", type: "uint256" },
  { name: "minUsdcFromSwap", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

// Pool reserves ABI
const poolReservesAbi = [
  { name: "getReserves", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "_reserve0", type: "uint256" }, { name: "_reserve1", type: "uint256" }, { name: "_blockTimestampLast", type: "uint256" }] as const },
  { name: "token0", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "address" }] as const },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [] as const, outputs: [{ name: "", type: "uint256" }] as const },
] as const;

function applySlippage(amount: bigint): bigint {
  return amount - (amount * SLIPPAGE_BPS) / 10000n;
}

export class AerodromeVaultService {
  private readonly config: EvmChainConfig;
  private readonly client: PublicClient;
  private readonly pools: AerodromePool[];
  private readonly defaultPool?: AerodromePool;

  constructor(config: EvmChainConfig) {
    this.config = config;
    this.client = createPublicClient({ chain: base, transport: http(config.rpcUrl) }) as PublicClient;
    const entry = config.protocols.find((p) => p.aerodromePools?.length);
    this.pools = entry?.aerodromePools ?? [];
    this.defaultPool = this.pools.find((p) => p.label === entry?.defaultAerodromePool) ?? this.pools[0];
  }

  get enabled(): boolean {
    return this.pools.length > 0;
  }

  /** Resolve a pool by label or address, falling back to the default. */
  resolvePool(ref?: string): AerodromePool {
    if (!ref) {
      if (!this.defaultPool) throw new Error("No Aerodrome pools configured.");
      return this.defaultPool;
    }
    const needle = ref.toLowerCase();
    const match = this.pools.find(
      (p) => p.label.toLowerCase() === needle || p.pool.toLowerCase() === needle || p.gauge.toLowerCase() === needle,
    );
    if (match) return match;
    // Fuzzy: check if ref appears in label
    const fuzzy = this.pools.find((p) => p.label.toLowerCase().includes(needle) || needle.includes(p.label.toLowerCase()));
    if (fuzzy) return fuzzy;
    throw new Error(`Aerodrome pool "${ref}" not found. Available: ${this.pools.map((p) => p.label).join(", ")}`);
  }

  /** Build the encoded `data` for AerodromeAdapter.depositFor. */
  async buildDepositData(
    usdcAmount: bigint,
    poolRef?: string,
  ): Promise<{ data: Address; pool: AerodromePool; expectedPairedOut: bigint }> {
    const pool = this.resolvePool(poolRef);
    const halfUsdc = usdcAmount / 2n;

    // Quote swap: USDC → pairedToken
    const factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as Address;
    const amounts = await this.client.readContract({
      address: this.config.aerodromeRouter,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [
        halfUsdc,
        [{ from: this.config.usdc, to: pool.pairedToken, stable: pool.stable, factory }],
      ],
    }) as bigint[];

    const expectedPairedOut = amounts[amounts.length - 1];
    const minPairedOut = applySlippage(expectedPairedOut);

    // LP minimums: slippage on each side
    const remainUsdc = usdcAmount - halfUsdc;
    const amountAMin = applySlippage(remainUsdc);
    const amountBMin = applySlippage(expectedPairedOut);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const data = encodeAbiParameters(DEPOSIT_DATA_ABI, [
      pool.poolKey,
      minPairedOut,
      amountAMin,
      amountBMin,
      deadline,
    ]);

    return { data: data as Address, pool, expectedPairedOut };
  }

  /** Build the encoded `data` for AerodromeAdapter.redeemFor. */
  async buildRedeemData(
    shares: bigint,
    poolRef?: string,
  ): Promise<{ data: Address; pool: AerodromePool; expectedUsdcOut: bigint }> {
    const pool = this.resolvePool(poolRef);

    // Read pool reserves to estimate the amounts from removeLiquidity
    const [reserves, token0, totalLpSupply] = await Promise.all([
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "getReserves" }) as Promise<[bigint, bigint, bigint]>,
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "token0" }) as Promise<string>,
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "totalSupply" }) as Promise<bigint>,
    ]);

    if (totalLpSupply === 0n) throw new Error("Aerodrome pool has zero LP supply.");

    const [reserve0, reserve1] = reserves;
    const usdcIsToken0 = token0.toLowerCase() === this.config.usdc.toLowerCase();

    const usdcReserve = usdcIsToken0 ? reserve0 : reserve1;
    const pairedReserve = usdcIsToken0 ? reserve1 : reserve0;

    // Pro-rata share of reserves
    const expectedUsdc = (usdcReserve * shares) / totalLpSupply;
    const expectedPaired = (pairedReserve * shares) / totalLpSupply;

    // Quote the swap: pairedToken → USDC
    let expectedUsdcFromSwap = 0n;
    if (expectedPaired > 0n) {
      const factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as Address;
      const amounts = await this.client.readContract({
        address: this.config.aerodromeRouter,
        abi: routerAbi,
        functionName: "getAmountsOut",
        args: [
          expectedPaired,
          [{ from: pool.pairedToken, to: this.config.usdc, stable: pool.stable, factory }],
        ],
      }) as bigint[];
      expectedUsdcFromSwap = amounts[amounts.length - 1];
    }

    const minAmountA = applySlippage(usdcIsToken0 ? expectedUsdc : expectedPaired);
    const minAmountB = applySlippage(usdcIsToken0 ? expectedPaired : expectedUsdc);
    const minUsdcFromSwap = applySlippage(expectedUsdcFromSwap);

    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    const data = encodeAbiParameters(REDEEM_DATA_ABI, [
      pool.poolKey,
      minAmountA,
      minAmountB,
      minUsdcFromSwap,
      deadline,
    ]);

    const expectedUsdcOut = expectedUsdc + expectedUsdcFromSwap;

    return { data: data as Address, pool, expectedUsdcOut };
  }

  /** Direct user-side withdraw — gauge is non-transferable so we bypass the vault. */
  async buildDirectWithdrawTxs(
    shares: bigint,
    receiver: Address,
    pool: AerodromePool,
    chainId: number,
  ): Promise<{ to: Address; data: Address; value: bigint; chainId: number }[]> {
    const txs: { to: Address; data: Address; value: bigint; chainId: number }[] = [];

    const approveAbi = [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }] as const;
    const withdrawAbi = [{ name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }] as const;

    // 1. Unstake from gauge → LP to user
    txs.push({
      to: pool.gauge,
      data: encodeFunctionData({ abi: withdrawAbi, functionName: "withdraw", args: [shares] }) as Address,
      value: 0n, chainId,
    });

    // 2. Approve LP to router
    txs.push({
      to: pool.pool,
      data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [this.config.aerodromeRouter, shares] }) as Address,
      value: 0n, chainId,
    });

    // 3. Estimate outputs from reserves
    const [reserves, token0, totalLpSupply] = await Promise.all([
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "getReserves" }) as Promise<[bigint, bigint, bigint]>,
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "token0" }) as Promise<string>,
      this.client.readContract({ address: pool.pool, abi: poolReservesAbi, functionName: "totalSupply" }) as Promise<bigint>,
    ]);

    const usdcIsToken0 = token0.toLowerCase() === this.config.usdc.toLowerCase();
    const [usdcReserve, pairedReserve] = usdcIsToken0 ? [reserves[0], reserves[1]] : [reserves[1], reserves[0]];
    const expectedUsdc = (usdcReserve * shares) / totalLpSupply;
    const expectedPaired = (pairedReserve * shares) / totalLpSupply;

    const amountAMin = 0n;
    const amountBMin = 0n;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS);

    // 4. removeLiquidity
    const removeLiqAbi = [{ name: "removeLiquidity", type: "function", stateMutability: "nonpayable", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "stable", type: "bool" }, { name: "liquidity", type: "uint256" }, { name: "amountAMin", type: "uint256" }, { name: "amountBMin", type: "uint256" }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amountA", type: "uint256" }, { name: "amountB", type: "uint256" }] }] as const;
    txs.push({
      to: this.config.aerodromeRouter,
      data: encodeFunctionData({ abi: removeLiqAbi, functionName: "removeLiquidity", args: [this.config.usdc, pool.pairedToken, pool.stable, shares, amountAMin, amountBMin, receiver, deadline] }) as Address,
      value: 0n, chainId,
    });

    // 5. Swap paired token → USDC
    if (expectedPaired > 0n) {
      const factory = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as Address;
      const swapAmounts = await this.client.readContract({
        address: this.config.aerodromeRouter, abi: routerAbi, functionName: "getAmountsOut",
        args: [expectedPaired, [{ from: pool.pairedToken, to: this.config.usdc, stable: pool.stable, factory }]],
      }) as bigint[];
      const minSwapOut = applySlippage(swapAmounts[swapAmounts.length - 1]);

      txs.push({
        to: pool.pairedToken,
        data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [this.config.aerodromeRouter, expectedPaired] }) as Address,
        value: 0n, chainId,
      });

      const swapAbi = [{ name: "swapExactTokensForTokens", type: "function", stateMutability: "nonpayable", inputs: [{ name: "amountIn", type: "uint256" }, { name: "amountOutMin", type: "uint256" }, { name: "routes", type: "tuple[]", components: [{ name: "from", type: "address" }, { name: "to", type: "address" }, { name: "stable", type: "bool" }, { name: "factory", type: "address" }] }, { name: "to", type: "address" }, { name: "deadline", type: "uint256" }], outputs: [{ name: "amounts", type: "uint256[]" }] }] as const;
      txs.push({
        to: this.config.aerodromeRouter,
        data: encodeFunctionData({ abi: swapAbi, functionName: "swapExactTokensForTokens", args: [expectedPaired, minSwapOut, [{ from: pool.pairedToken, to: this.config.usdc, stable: pool.stable, factory }], receiver, deadline] }) as Address,
        value: 0n, chainId,
      });
    }

    return txs;
  }
}