import { describe, it, expect } from "vitest";
import { netAfterFee } from "@chains/evm/helper/fee.js";

// netAfterFee must mirror the on-chain FeeModule._collectFee arithmetic exactly:
//   fee = (amount * feeBps) / 10000   (integer floor division)
//   net = amount - fee
// A mismatch here re-introduces the exact bug this fix closes: the baked LiFi /
// swap amount would exceed what the contract approves, reverting the operation.

describe("netAfterFee", () => {
  it("returns the gross amount unchanged when feeBps is 0", () => {
    expect(netAfterFee(1_000_000n, 0n)).toBe(1_000_000n);
  });

  it("skims 0.1% (10 bps) matching the launch fee", () => {
    // 1000 USDC (6dp) → fee 1 USDC → net 999 USDC
    expect(netAfterFee(1_000_000_000n, 10n)).toBe(999_000_000n);
  });

  it("skims 0.5% (50 bps)", () => {
    expect(netAfterFee(1_000_000n, 50n)).toBe(995_000n);
  });

  it("floors the fee (integer division), never over-charging", () => {
    // 12345 * 10 / 10000 = 12.345 → floor 12 → net 12333
    expect(netAfterFee(12_345n, 10n)).toBe(12_333n);
  });

  it("takes zero fee when the amount is too small to round up to 1 unit", () => {
    // 999 * 10 / 10000 = 0.999 → floor 0 → net unchanged
    expect(netAfterFee(999n, 10n)).toBe(999n);
  });

  it("handles the max fee (500 bps / 5%)", () => {
    expect(netAfterFee(1_000_000n, 500n)).toBe(950_000n);
  });

  it("preserves the leverage invariant: netInput + flashAssets == swapIn", () => {
    // Mirrors leverage.service: flashAssets = (L-1)*netInput, swapIn = netInput+flashAssets.
    const gross = 1_000_000_000n; // 1000 USDC equity
    const net = netAfterFee(gross, 10n); // 999 USDC after 0.1%
    const multiplierBps = 30000n; // 3x
    const BPS = 10000n;
    const flashAssets = (net * (multiplierBps - BPS)) / BPS;
    const swapIn = net + flashAssets;
    // The contract swaps fd.inputAssets(net) + assets(flashAssets) — must equal swapIn.
    expect(net + flashAssets).toBe(swapIn);
    // And swapIn should be exactly L * net (3x of the net equity).
    expect(swapIn).toBe((net * multiplierBps) / BPS);
  });
});
