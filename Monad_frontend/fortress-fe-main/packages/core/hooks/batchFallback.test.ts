import { describe, it, expect } from "vitest";
import {
  AtomicReadyWalletRejectedUpgradeError,
  AtomicityNotSupportedError,
  UnsupportedNonOptionalCapabilityError,
  BundleTooLargeError,
  UserRejectedRequestError,
  MethodNotSupportedRpcError,
} from "viem";
import { isBatchUnsupported, errorCodes } from "./batchFallback";

// Constructed from viem's real error classes, not hand-written stand-ins, so
// the codes and messages are exactly what a wallet will produce.
const inner = (msg: string) => new Error(msg);

describe("isBatchUnsupported — falls back to sequential sends", () => {
  it("handles the EIP-7702 upgrade the user declined (5750)", () => {
    // The reported failure: "The Wallet can support atomicity after an
    // upgrade, but the user rejected the upgrade." Declining an ACCOUNT
    // UPGRADE is not declining the TRANSACTION, so the deploy must continue
    // one call at a time rather than aborting.
    const err = new AtomicReadyWalletRejectedUpgradeError(inner("x"));
    expect(err.message).toMatch(/rejected the upgrade/i);
    // Note it contains none of the substrings the old message-matching used.
    expect(err.message.toLowerCase()).not.toContain("does not support");
    expect(isBatchUnsupported(err)).toBe(true);
  });

  it.each([
    ["5760 atomicity not supported", new AtomicityNotSupportedError(inner("x"))],
    ["5700 unsupported non-optional capability", new UnsupportedNonOptionalCapabilityError(inner("x"))],
    ["5740 bundle too large", new BundleTooLargeError(inner("x"))],
    ["4200 method not supported", new MethodNotSupportedRpcError(inner("x"))],
  ])("falls back on %s", (_label, err) => {
    expect(isBatchUnsupported(err)).toBe(true);
  });

  it("finds the code when viem nests it under .cause", () => {
    const wrapped = Object.assign(new Error("wrapped"), {
      cause: new AtomicReadyWalletRejectedUpgradeError(inner("x")),
    });
    expect(isBatchUnsupported(wrapped)).toBe(true);
  });

  it("falls back for a wallet with no numeric code at all", () => {
    expect(isBatchUnsupported(new Error("wallet_sendCalls is not supported"))).toBe(true);
  });
});

describe("isBatchUnsupported — must NOT retry", () => {
  it("propagates a user rejecting the transaction itself (4001)", () => {
    // Retrying sequentially would re-prompt someone who already said no.
    const err = new UserRejectedRequestError(inner("User rejected the request."));
    expect(isBatchUnsupported(err)).toBe(false);
  });

  it("propagates an on-chain revert", () => {
    const err = new Error("execution reverted: ERC20: transfer amount exceeds balance");
    expect(isBatchUnsupported(err)).toBe(false);
  });

  it("propagates insufficient funds", () => {
    const err = new Error("insufficient funds for gas * price + value");
    expect(isBatchUnsupported(err)).toBe(false);
  });

  it("prefers the 4001 code over a message that looks fallback-worthy", () => {
    const err = Object.assign(new Error("wallet does not support this, user rejected"), {
      code: 4001,
    });
    expect(isBatchUnsupported(err)).toBe(false);
  });
});

describe("errorCodes", () => {
  it("walks the whole cause chain", () => {
    const deep = Object.assign(new Error("a"), {
      code: 1,
      cause: Object.assign(new Error("b"), {
        code: 2,
        cause: Object.assign(new Error("c"), { code: 3 }),
      }),
    });
    expect(errorCodes(deep)).toEqual([1, 2, 3]);
  });

  it("terminates on a self-referential cause", () => {
    const loop: { code: number; cause?: unknown } = { code: 9 };
    loop.cause = loop;
    expect(errorCodes(loop)).toEqual([9, 9, 9, 9, 9, 9]);
  });

  it("returns nothing for a plain error", () => {
    expect(errorCodes(new Error("plain"))).toEqual([]);
  });
});
