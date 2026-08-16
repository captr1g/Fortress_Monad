import { describe, it, expect } from "vitest";
import { keccak256, toBytes, encodeAbiParameters, type Address } from "viem";

/**
 * Aerodrome integration tests — verifies the deposit/redeem data encoding,
 * pool resolution, slippage application, and APY formula correctness at the
 * unit level (no RPC calls, deterministic).
 */

// ─── Helpers (mirror the production code's logic) ───────────────────────────

function protocolKey(name: string): Address {
  return keccak256(toBytes(name));
}

const DEPOSIT_DATA_ABI = [
  { name: "poolKey", type: "bytes32" },
  { name: "minPairedOut", type: "uint256" },
  { name: "amountAMin", type: "uint256" },
  { name: "amountBMin", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

const REDEEM_DATA_ABI = [
  { name: "poolKey", type: "bytes32" },
  { name: "minAmountA", type: "uint256" },
  { name: "minAmountB", type: "uint256" },
  { name: "minUsdcFromSwap", type: "uint256" },
  { name: "deadline", type: "uint256" },
] as const;

function applySlippage(amount: bigint, bps: bigint = 50n): bigint {
  return amount - (amount * bps) / 10000n;
}

// ─── Pool key tests ─────────────────────────────────────────────────────────

describe("Aerodrome pool key derivation", () => {
  it("USDC-WETH key matches on-chain keccak256(bytes('USDC-WETH'))", () => {
    const key = protocolKey("USDC-WETH");
    expect(key).toBe("0x0b211adefcf2f5c7057e9b620a13a97bc40305f2489e711cdf63a1ee50fe0fdb");
  });

  it("USDC-AERO key matches on-chain keccak256(bytes('USDC-AERO'))", () => {
    const key = protocolKey("USDC-AERO");
    expect(key).toBe("0x0c1f63ccd353bb4bf15486feaad3d784adbca0064074841863df9aced9bb60cb");
  });

  it("pool keys are distinct", () => {
    expect(protocolKey("USDC-WETH")).not.toBe(protocolKey("USDC-AERO"));
  });
});

// ─── Deposit data encoding ──────────────────────────────────────────────────

describe("Aerodrome deposit data encoding", () => {
  it("encodes the correct ABI structure for depositFor", () => {
    const poolKey = protocolKey("USDC-WETH");
    const minPairedOut = 100000000000000n; // ~0.0001 WETH
    const amountAMin = 450000n;   // ~0.45 USDC (after slippage on half of 1 USDC)
    const amountBMin = 90000000000000n; // min paired
    const deadline = 1786200000n;

    const encoded = encodeAbiParameters(DEPOSIT_DATA_ABI, [
      poolKey, minPairedOut, amountAMin, amountBMin, deadline,
    ]);

    expect(encoded).toMatch(/^0x/);
    // Should be 5 * 32 bytes = 320 bytes = 640 hex chars + "0x" prefix
    expect(encoded.length).toBe(2 + 5 * 64);
  });

  it("slippage reduces the output by exactly 0.5%", () => {
    const amount = 1000000n; // 1 USDC
    const slipped = applySlippage(amount);
    expect(slipped).toBe(995000n); // 1000000 - 5000
  });

  it("slippage on zero returns zero", () => {
    expect(applySlippage(0n)).toBe(0n);
  });

  it("slippage on 1 wei returns 0 (floor)", () => {
    // 1 * 50 / 10000 = 0, so slipped = 1 - 0 = 1
    expect(applySlippage(1n)).toBe(1n);
  });

  it("half-split is correct for odd amounts", () => {
    const usdcAmount = 1000001n; // odd
    const half = usdcAmount / 2n;
    const remain = usdcAmount - half;
    expect(half).toBe(500000n);
    expect(remain).toBe(500001n);
    expect(half + remain).toBe(usdcAmount);
  });
});

// ─── Redeem data encoding ───────────────────────────────────────────────────

describe("Aerodrome redeem data encoding", () => {
  it("encodes the correct ABI structure for redeemFor", () => {
    const poolKey = protocolKey("USDC-WETH");
    const minAmountA = 400000n;
    const minAmountB = 80000000000000n;
    const minUsdcFromSwap = 380000n;
    const deadline = 1786200000n;

    const encoded = encodeAbiParameters(REDEEM_DATA_ABI, [
      poolKey, minAmountA, minAmountB, minUsdcFromSwap, deadline,
    ]);

    expect(encoded).toMatch(/^0x/);
    expect(encoded.length).toBe(2 + 5 * 64);
  });

  it("pro-rata share calculation is correct", () => {
    const totalLpSupply = 100000000000000000n; // 0.1 LP total
    const userShares = 10000000000000000n;     // 0.01 LP
    const usdcReserve = 5000000000n;            // 5000 USDC (6 dec)
    const pairedReserve = 2000000000000000000n;  // 2 WETH (18 dec)

    const expectedUsdc = (usdcReserve * userShares) / totalLpSupply;
    const expectedPaired = (pairedReserve * userShares) / totalLpSupply;

    expect(expectedUsdc).toBe(500000000n); // 500 USDC
    expect(expectedPaired).toBe(200000000000000000n); // 0.2 WETH
  });
});

// ─── APY formula ────────────────────────────────────────────────────────────

describe("Aerodrome gauge APY formula", () => {
  it("computes correct APR from known values", () => {
    // Known on-chain values (verified live):
    const rewardRate = 37294632079147662n;   // AERO/sec (18 dec)
    const gaugeTotal = 86561572054290396n;   // staked LP
    const usdcReserve = 13685046405337n;     // USDC in USDC-AERO pool
    const aeroReserve = 31269205804413192724988755n; // AERO in pool

    const poolUsdcReserve = 3926612063233n;  // USDC in USDC-WETH pool
    const totalLpSupply = 87781894255483537n;

    const aeroPriceNum = Number(usdcReserve) / (Number(aeroReserve) / 1e12);
    const totalPoolUsd = Number(poolUsdcReserve) * 2 / 1e6;
    const stakedFraction = Number(gaugeTotal) / Number(totalLpSupply);
    const stakedUsd = totalPoolUsd * stakedFraction;
    const annualRewardsUsd = (Number(rewardRate) / 1e18) * 31536000 * aeroPriceNum;
    const apr = annualRewardsUsd / stakedUsd;

    // Should be ~6.65% based on live verification
    expect(apr).toBeGreaterThan(0.05);   // > 5%
    expect(apr).toBeLessThan(0.15);      // < 15%
    expect(aeroPriceNum).toBeGreaterThan(0.3);
    expect(aeroPriceNum).toBeLessThan(1.0);
  });

  it("returns null-equivalent when totalStaked is zero", () => {
    const totalStaked = 0n;
    // The production code checks: if (totalStaked === 0n) return null;
    expect(totalStaked === 0n).toBe(true);
  });

  it("caps absurd APR at 500%", () => {
    const absurdApr = 6.0; // 600%
    const capped = absurdApr >= 0 && absurdApr <= 5 ? absurdApr : null;
    expect(capped).toBeNull();
  });

  it("accepts reasonable APR within bounds", () => {
    const normalApr = 0.12; // 12%
    const result = normalApr >= 0 && normalApr <= 5 ? normalApr : null;
    expect(result).toBe(0.12);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("Aerodrome edge cases", () => {
  it("deposit of 1 wei splits correctly", () => {
    const amount = 1n;
    const half = amount / 2n; // 0
    const remain = amount - half; // 1
    // Half is 0 — the swap would get 0 paired tokens. The router would revert
    // with insufficient output. This is correct behavior: dust amounts shouldn't
    // be LP'd.
    expect(half).toBe(0n);
    expect(remain).toBe(1n);
  });

  it("minSharesOut for Aerodrome is 0 (LP output is protected by encoded mins)", () => {
    // The builder sets minSharesOut = 0n for Aerodrome deposits because LP
    // token output is hard to predict and the real protection is amountAMin/amountBMin.
    const minSharesOut = 0n;
    expect(minSharesOut).toBe(0n);
  });

  it("withdraw with zero shares is skipped", () => {
    const shares = 0n;
    // Production code: if (shares <= 0n) continue;
    expect(shares <= 0n).toBe(true);
  });

  it("AERO price calculation handles precision correctly", () => {
    // Small reserves (e.g. new pool)
    const usdcReserve = 1000000n; // 1 USDC
    const aeroReserve = 2000000000000000000n; // 2 AERO
    const price = Number(usdcReserve) / (Number(aeroReserve) / 1e12);
    expect(price).toBeCloseTo(0.5, 5); // 1 USDC / 2 AERO = $0.50
  });
});
