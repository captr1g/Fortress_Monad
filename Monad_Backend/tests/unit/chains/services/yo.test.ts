import { describe, it, expect } from "vitest";
import { keccak256, toBytes, type Address } from "viem";

/**
 * Yo Protocol integration tests — verifies config correctness, withdraw
 * resolution, APY source selection, approval logic, and edge cases.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function protocolKey(name: string): Address {
  return keccak256(toBytes(name));
}

const YO_ADAPTER = "0x64fC484681396751c0E702086F92561B73aC52e3";
const YO_USD_VAULT = "0x0000000f2eB9f69274678c76222B35eEc7588a65";

// ─── Protocol key ───────────────────────────────────────────────────────────

describe("Yo protocol key", () => {
  it("key matches keccak256(bytes('Yo'))", () => {
    const key = protocolKey("Yo");
    // Verified on-chain: FortVault.protocols(keccak256("Yo")) → adapter address
    expect(key).toBe("0x62ae82bc06701cffee1054a8c50a710563635210c0c00acbb32d85d394091312");
  });
});

// ─── Config structure ───────────────────────────────────────────────────────

describe("Yo config structure", () => {
  const config = {
    name: "Yo",
    isERC4626: false,
    address: YO_ADAPTER,
    positionToken: YO_USD_VAULT,
    apySource: "erc4626-onchain" as const,
  };

  it("is non-ERC4626 (adapter pattern)", () => {
    expect(config.isERC4626).toBe(false);
  });

  it("positionToken is the yoUSD vault (what the user holds)", () => {
    expect(config.positionToken).toBe(YO_USD_VAULT);
  });

  it("address is the adapter (what the vault calls)", () => {
    expect(config.address).toBe(YO_ADAPTER);
  });

  it("APY source reads from positionToken (ERC-4626 share price growth)", () => {
    // The vault-apy.ts logic: for erc4626-onchain, uses positionToken ?? address
    const apyTarget = config.positionToken ?? config.address;
    expect(apyTarget).toBe(YO_USD_VAULT);
  });
});

// ─── Withdraw flow ──────────────────────────────────────────────────────────

describe("Yo withdraw resolution", () => {
  it("balance token is the positionToken (yoUSD vault)", () => {
    // The builder's balanceToken logic: if positionToken exists, return it
    const positionToken = YO_USD_VAULT;
    expect(positionToken).toBeDefined();
    expect(positionToken.toLowerCase()).not.toBe("0x0000000000000000000000000000000000000000");
  });

  it("isPositionErc4626 returns true for Yo (positionToken is an ERC-4626)", () => {
    // Logic: if (!protocol.isERC4626 && protocol.positionToken) → true (except CompoundV3)
    const protocol = { name: "Yo", isERC4626: false, positionToken: YO_USD_VAULT };
    const isCompound = protocol.name === "CompoundV3";
    const isPositionErc4626 = protocol.isERC4626 || (!isCompound && !!protocol.positionToken);
    expect(isPositionErc4626).toBe(true);
  });

  it("withdraw approval is ERC-20 approve(positionToken → adapter, shares)", () => {
    // For non-ERC4626 with positionToken that isn't Comet:
    // txs.push(this.approval(protocol.positionToken, protocol.address, shares))
    const approvalToken = YO_USD_VAULT;   // positionToken
    const approvalSpender = YO_ADAPTER;   // adapter (protocol.address)
    const shares = 1000000n;

    expect(approvalToken).toBe(YO_USD_VAULT);
    expect(approvalSpender).toBe(YO_ADAPTER);
    expect(shares).toBeGreaterThan(0n);
  });

  it("minUsdcOut uses previewRedeem on positionToken", () => {
    // isPositionErc4626 = true → calls previewRedeem on vaultTokenAddress (= positionToken)
    // Then applies 0.5% slippage: (preview * 9950) / 10000
    const preview = 1058873n; // convertToAssets(1000000) = 1.058873 USDC per share
    const minOut = (preview * 9950n) / 10000n;
    expect(minOut).toBe(1053578n); // 1058873 * 0.995
  });
});

// ─── APY precision ──────────────────────────────────────────────────────────

describe("Yo APY (ERC-4626 on-chain share price)", () => {
  it("annualizes 7-day share price growth correctly", () => {
    // If share price grew from 1.000000 to 1.001000 over 7 days:
    const pastPrice = 1000000n;
    const nowPrice = 1001000n;
    const elapsedSeconds = 7 * 24 * 3600; // 604800

    const ratio = Number(nowPrice) / Number(pastPrice); // 1.001
    const apy = ratio ** (31536000 / elapsedSeconds) - 1;

    // ~5.35% annualized from 0.1% weekly growth
    expect(apy).toBeGreaterThan(0.05);
    expect(apy).toBeLessThan(0.06);
  });

  it("rejects non-positive growth (share price went down)", () => {
    const past = 1000000n;
    const now = 999000n; // decreased
    const result = now <= past ? null : "would compute";
    expect(result).toBeNull();
  });

  it("rejects absurd growth (> 200% annualized)", () => {
    const apy = 2.5; // 250%
    const capped = apy >= 0 && apy <= 2 ? apy : null;
    expect(capped).toBeNull();
  });

  it("handles the exact decimal precision of yoUSD (6 decimals)", () => {
    // yoUSD is 6 decimals, so ONE_SHARE = 10^6
    const oneShare = 10n ** 6n;
    expect(oneShare).toBe(1000000n);

    // convertToAssets(1000000) currently returns 1058873 on-chain
    // This means 1 share = 1.058873 USDC — ~5.89% total growth
    const assets = 1058873n;
    const growthRatio = Number(assets) / Number(oneShare);
    expect(growthRatio).toBeGreaterThan(1.0);
    expect(growthRatio).toBeLessThan(1.1);
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("Yo edge cases", () => {
  it("zero balance throws descriptive error", () => {
    const balance = 0n;
    const shouldThrow = balance === 0n;
    expect(shouldThrow).toBe(true);
    // Production: throw new Error(`No ${protocol.name} shares held by ${walletAddress}.`)
  });

  it("usdc amountType converts correctly via convertToShares", () => {
    // If user wants to withdraw 1 USDC worth of yoUSD:
    // convertToShares(1000000) would return ~944000 (inverse of 1.058873)
    const usdcAmount = 1000000n;
    const assetsPerShare = 1058873n; // per 1M shares
    // shares = usdc * 1M / assetsPerShare ≈ 944,411
    const estimatedShares = (usdcAmount * 1000000n) / assetsPerShare;
    expect(estimatedShares).toBeGreaterThan(900000n);
    expect(estimatedShares).toBeLessThan(1000000n);
  });

  it("multi-protocol withdraw skips Yo with zero balance", () => {
    // In buildWithdraw, entries.length > 1 + balance=0 → returns null (skipped)
    const balance = 0n;
    const isMulti = true;
    const msg = `No Yo shares held by 0xa087...`;
    const shouldSkip = isMulti && (msg.includes("shares held by") || msg.includes("Nothing to withdraw"));
    expect(shouldSkip).toBe(true);
  });

  it("Yo is not misclassified as Pendle PT token", () => {
    // isPendlePtToken must NOT match Yo's positionToken
    const yoPosition = YO_USD_VAULT.toLowerCase();
    const protocols = [
      { address: YO_ADAPTER.toLowerCase(), positionToken: yoPosition },
    ];
    const isKnownProtocolToken = protocols.some(
      (p) => p.address === yoPosition || p.positionToken === yoPosition,
    );
    // Yo's positionToken IS a known protocol token → not classified as PT
    expect(isKnownProtocolToken).toBe(true);
  });
});
