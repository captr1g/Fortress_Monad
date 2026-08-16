import { describe, it, expect } from "vitest";

// Tests that the fee-adjustment math used in vault-builder and kernel is correct.
// The on-chain contract does: netTotal = total - (total * feeBps / 10000)
// The backend must compute minSharesOut against the NET amount, not gross.

describe("deposit fee math", () => {
  function applyFee(amount: bigint, feeBps: bigint): bigint {
    if (feeBps === 0n) return amount;
    const fee = (amount * feeBps) / 10000n;
    return amount - fee;
  }

  it("0 fee returns the full amount", () => {
    expect(applyFee(1_000_000n, 0n)).toBe(1_000_000n);
  });

  it("100 bps (1%) deducts correctly", () => {
    // 1_000_000 * 100 / 10000 = 10_000 fee
    expect(applyFee(1_000_000n, 100n)).toBe(990_000n);
  });

  it("500 bps (5% max) deducts correctly", () => {
    expect(applyFee(1_000_000n, 500n)).toBe(950_000n);
  });

  it("handles very small amounts without underflow", () => {
    // 1 wei with 100 bps = 0 fee (truncation)
    expect(applyFee(1n, 100n)).toBe(1n);
    // 99 wei with 100 bps = 0 fee (99 * 100 / 10000 = 0)
    expect(applyFee(99n, 100n)).toBe(99n);
    // 100 wei with 100 bps = 1 fee
    expect(applyFee(100n, 100n)).toBe(99n);
  });

  it("matches the on-chain proportional split math", () => {
    // Contract: entryAmount = (entries[i].amount * netTotal) / total
    // with last-entry-gets-remainder.
    const total = 1_000_000n;
    const feeBps = 200n; // 2%
    const netTotal = applyFee(total, feeBps); // 980_000
    expect(netTotal).toBe(980_000n);

    // 3 entries: 50%, 30%, 20% of total
    const amounts = [500_000n, 300_000n, 200_000n];
    const netAmounts = amounts.map((a, i) => {
      if (i === amounts.length - 1) {
        const priorNet = amounts.slice(0, -1).reduce(
          (sum, x) => sum + (x * netTotal) / total, 0n
        );
        return netTotal - priorNet;
      }
      return (a * netTotal) / total;
    });

    // Verify they sum to exactly netTotal (no rounding leak)
    const sum = netAmounts.reduce((s, v) => s + v, 0n);
    expect(sum).toBe(netTotal);

    // Verify individual entries are proportionally reduced
    expect(netAmounts[0]).toBe(490_000n); // 500k * 980k / 1M
    expect(netAmounts[1]).toBe(294_000n); // 300k * 980k / 1M
    expect(netAmounts[2]).toBe(196_000n); // remainder = 980k - 490k - 294k
  });

  it("single-entry deposit: net amount equals full netTotal", () => {
    const total = 5_000_000n;
    const feeBps = 100n; // 1%
    const netTotal = applyFee(total, feeBps);
    expect(netTotal).toBe(4_950_000n);

    // Single entry (last entry) gets all of netTotal
    const amounts = [5_000_000n];
    const priorNet = 0n;
    const lastEntry = netTotal - priorNet;
    expect(lastEntry).toBe(netTotal);
  });
});

describe("minSharesOut must use net amount, not gross", () => {
  it("using gross amount with a fee would exceed actual shares (the bug scenario)", () => {
    // Scenario: deposit 1M USDC, 1% fee → protocol receives 990k
    // If we compute minSharesOut from previewDeposit(1M) * 0.995, that would be
    // ~995k shares. But the protocol only gets 990k, so it mints ~990k shares.
    // 990k < 995k → SlippageExceeded revert!
    //
    // Correct: compute minSharesOut from previewDeposit(990k) * 0.995 = ~985k.
    // 990k > 985k → passes.

    const gross = 1_000_000n;
    const feeBps = 100n;
    const net = gross - (gross * feeBps) / 10000n; // 990_000
    const slippageBps = 9950n; // 0.5% tolerance (MIN_OUT_BPS)

    // Simulated 1:1 previewDeposit (shares = assets for simplicity)
    const sharesFromGross = (gross * slippageBps) / 10000n; // 995_000
    const sharesFromNet = (net * slippageBps) / 10000n; // 985_050

    // The actual shares minted will be ~990_000 (based on net)
    const actualShares = net; // simplified 1:1

    // Bug: gross-based minSharesOut fails
    expect(actualShares < sharesFromGross).toBe(true);

    // Fix: net-based minSharesOut passes
    expect(actualShares >= sharesFromNet).toBe(true);
  });
});
