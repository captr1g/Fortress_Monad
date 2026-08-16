import { describe, it, expect } from "vitest";
import { computeNetApy, aggregateStrategyApy } from "@chains/evm/execution/apy.js";
import type { StrategyLeg, StrategyLegRates } from "@core/services/apy/types.js";

type Leg = StrategyLeg & StrategyLegRates;

function leg(o: Partial<Leg> = {}): Leg {
  return {
    marketKey: "cbETH-USDC",
    marketKeyHash: "0xhash",
    collateralToken: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",
    collateralValue: 200,
    debtValue: 100,
    collateralApy: 0.05,
    collateralStatus: "ok",
    borrowApy: 0.03,
    borrowStatus: "ok",
    rewardsApy: 0,
    ...o,
  };
}

describe("computeNetApy", () => {
  it("computes (earn - cost) / equity", () => {
    // earn = 200*0.05 + 100*0 = 10; cost = 100*0.03 = 3; net = 7/100
    expect(
      computeNetApy({
        equity: 100,
        collateralValue: 200,
        debtValue: 100,
        collateralApy: 0.05,
        borrowApy: 0.03,
        rewardsApy: 0,
      }),
    ).toBeCloseTo(0.07, 10);
  });

  it("credits rewards APY on the debt notional", () => {
    // earn = 200*0.05 + 100*0.02 = 12; cost = 3; net = 9/100
    expect(
      computeNetApy({
        equity: 100,
        collateralValue: 200,
        debtValue: 100,
        collateralApy: 0.05,
        borrowApy: 0.03,
        rewardsApy: 0.02,
      }),
    ).toBeCloseTo(0.09, 10);
  });

  it("can go negative when borrow cost exceeds earnings", () => {
    expect(
      computeNetApy({
        equity: 100,
        collateralValue: 100,
        debtValue: 100,
        collateralApy: 0.01,
        borrowApy: 0.1,
        rewardsApy: 0,
      }),
    ).toBeLessThan(0);
  });
});

describe("aggregateStrategyApy", () => {
  it("computes equity, leverage, netApy and weighted blends for a single healthy leg", () => {
    const out = aggregateStrategyApy([leg()], 0);
    expect(out.status).toBe("ok");
    expect(out.equity).toBe(100); // 200 + 0 - 100
    expect(out.leverage).toBe(2); // 200 / 100
    expect(out.netApy).toBeCloseTo(0.07, 10);
    expect(out.collateralApy).toBeCloseTo(0.05, 10);
    expect(out.borrowApy).toBeCloseTo(0.03, 10);
  });

  it("folds idle cash into equity", () => {
    const out = aggregateStrategyApy([leg({ collateralValue: 100, debtValue: 50 })], 20);
    expect(out.equity).toBe(70); // 100 + 20 - 50
  });

  it("aggregates multiple legs at their own rates", () => {
    const out = aggregateStrategyApy(
      [
        leg({ collateralValue: 100, debtValue: 50, collateralApy: 0.04, borrowApy: 0.02 }),
        leg({ collateralValue: 300, debtValue: 100, collateralApy: 0.06, borrowApy: 0.03 }),
      ],
      0,
    );
    // equity = 400 - 150 = 250; leverage = 400/250 = 1.6
    expect(out.equity).toBe(250);
    expect(out.leverage).toBeCloseTo(1.6, 10);
    // earn = 100*0.04 + 300*0.06 = 4 + 18 = 22; cost = 50*0.02 + 100*0.03 = 1 + 3 = 4
    expect(out.netApy).toBeCloseTo((22 - 4) / 250, 10);
    // collateral blend = (100*0.04 + 300*0.06) / 400 = 22/400
    expect(out.collateralApy).toBeCloseTo(22 / 400, 10);
    // borrow blend = (50*0.02 + 100*0.03) / 150 = 4/150
    expect(out.borrowApy).toBeCloseTo(4 / 150, 10);
  });

  it("marks the result unavailable (netApy null) when a debt leg's borrow rate is missing", () => {
    const out = aggregateStrategyApy([leg({ borrowApy: null, borrowStatus: "unavailable" })], 0);
    expect(out.status).toBe("unavailable");
    expect(out.netApy).toBeNull();
  });

  it("marks unavailable when a collateral leg's rate is missing", () => {
    const out = aggregateStrategyApy([leg({ collateralApy: null, collateralStatus: "unavailable" })], 0);
    expect(out.status).toBe("unavailable");
    expect(out.netApy).toBeNull();
  });

  it("ignores a missing rate on a zero-value leg (no impact on availability)", () => {
    // debtValue 0 with a null borrow rate should NOT flip status to unavailable.
    const out = aggregateStrategyApy([leg({ debtValue: 0, borrowApy: null, borrowStatus: "unavailable" })], 0);
    expect(out.status).toBe("ok");
    expect(out.netApy).not.toBeNull();
  });

  it("returns unavailable with zero leverage when equity is non-positive", () => {
    const out = aggregateStrategyApy([leg({ collateralValue: 100, debtValue: 150 })], 0);
    expect(out.equity).toBeLessThanOrEqual(0);
    expect(out.leverage).toBe(0);
    expect(out.status).toBe("unavailable");
    expect(out.netApy).toBeNull();
  });

  it("returns null blends for an empty leg set", () => {
    const out = aggregateStrategyApy([], 0);
    expect(out.collateralApy).toBeNull();
    expect(out.borrowApy).toBeNull();
    expect(out.status).toBe("unavailable"); // equity 0, not > 0
  });
});
