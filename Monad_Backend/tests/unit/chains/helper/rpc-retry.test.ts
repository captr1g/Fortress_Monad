import { describe, it, expect, vi } from "vitest";
import { withRpcRetry } from "@chains/evm/helper/rpc-retry.js";

// Guards the reason this helper exists: a slippage-critical read that fails
// must surface as an error, never as a guessed number. A 1:1 share-price guess
// is what put minSharesOut=497500 on a Curvance deposit that could only return
// 494462 shares, so the vault reverted and the user paid gas to find out.

describe("withRpcRetry", () => {
  it("returns the value when the first attempt succeeds", async () => {
    const fn = vi.fn().mockResolvedValue(42n);
    await expect(withRpcRetry("read", fn)).resolves.toBe(42n);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure and returns the eventual value", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("UND_ERR_CONNECT_TIMEOUT"))
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValue(495001n);
    await expect(withRpcRetry("previewDeposit", fn)).resolves.toBe(495001n);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting attempts, naming the read and keeping the cause", async () => {
    const cause = new Error("The request timed out.");
    const fn = vi.fn().mockRejectedValue(cause);
    await expect(withRpcRetry("Curvance.previewDeposit", fn, 3)).rejects.toThrow(
      /Curvance\.previewDeposit failed after 3 attempt\(s\)/,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a revert — the chain already gave a definitive answer", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("execution reverted"));
    await expect(withRpcRetry("maxDeposit", fn, 4)).rejects.toThrow(/failed after 4 attempt/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry a missing function", async () => {
    const err = Object.assign(new Error("boom"), { name: "ContractFunctionRevertedError" });
    const fn = vi.fn().mockRejectedValue(err);
    await expect(withRpcRetry("asset", fn, 4)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("preserves the original error as `cause` for callers that inspect it", async () => {
    const cause = new Error("socket hang up");
    const fn = vi.fn().mockRejectedValue(cause);
    const err = await withRpcRetry("x", fn, 2).catch((e: unknown) => e);
    expect((err as Error).cause).toBe(cause);
  });
});
