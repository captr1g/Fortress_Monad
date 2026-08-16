import { describe, it, expect } from "vitest";
import { encodeErrorResult, stringToHex, type Hex } from "viem";
import {
  decodeRevertData,
  decodeRevertFromResult,
} from "@chains/evm/helper/revert-decoder.js";

// Helper: encode a Fortress custom error the way a reverting contract would,
// so the test exercises real ABI-encoded revert data (selector + args).
function encodeErr(name: string, inputs: { type: string }[], args: unknown[]): Hex {
  return encodeErrorResult({
    abi: [{ type: "error", name, inputs: inputs.map((i, n) => ({ name: `a${n}`, type: i.type })) }],
    errorName: name,
    args,
  });
}

describe("decodeRevertData — Fortress custom errors", () => {
  it("decodes a no-arg error to its name", () => {
    const data = encodeErr("SwapFailed", [], []);
    expect(decodeRevertData(data)).toMatch(/DEX swap call reverted/i);
  });

  it("decodes SlippageExceeded with its args into a friendly message", () => {
    const data = encodeErr(
      "SlippageExceeded",
      [{ type: "uint256" }, { type: "uint256" }],
      [950n, 1000n],
    );
    const msg = decodeRevertData(data);
    expect(msg).toContain("950");
    expect(msg).toContain("1000");
    expect(msg).toMatch(/slippage/i);
  });

  it("decodes AdapterNotRegistered with the adapter id", () => {
    const data = encodeErr("AdapterNotRegistered", [{ type: "uint8" }], [2]);
    const msg = decodeRevertData(data);
    expect(msg).toContain("#2");
    expect(msg).toMatch(/adapter/i);
  });

  it("decodes an unmapped error generically as Name(args)", () => {
    // BorrowExceedsCeiling has no FRIENDLY entry → generic "Name(a, b)".
    const data = encodeErr(
      "BorrowExceedsCeiling",
      [{ type: "uint256" }, { type: "uint256" }],
      [500n, 400n],
    );
    expect(decodeRevertData(data)).toBe("BorrowExceedsCeiling(500, 400)");
  });
});

describe("decodeRevertData — standard reverts", () => {
  it("decodes Error(string) (require/revert message)", () => {
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Error", inputs: [{ name: "r", type: "string" }] }],
      errorName: "Error",
      args: ["ERC20: transfer amount exceeds balance"],
    });
    expect(decodeRevertData(data)).toBe("ERC20: transfer amount exceeds balance");
  });

  it("decodes Panic(uint256) with a hint for overflow", () => {
    const data = encodeErrorResult({
      abi: [{ type: "error", name: "Panic", inputs: [{ name: "c", type: "uint256" }] }],
      errorName: "Panic",
      args: [0x11n],
    });
    expect(decodeRevertData(data)).toMatch(/overflow\/underflow/i);
  });

  it("returns null for unknown selectors", () => {
    expect(decodeRevertData("0xdeadbeef" as Hex)).toBeNull();
  });

  it("returns null for blobs too short to hold a selector", () => {
    expect(decodeRevertData("0x1234" as Hex)).toBeNull();
  });
});

describe("decodeRevertFromResult — scans a Tenderly-shaped payload", () => {
  it("finds the revert blob nested anywhere in the result object", () => {
    const data = encodeErr(
      "SlippageExceeded",
      [{ type: "uint256" }, { type: "uint256" }],
      [1n, 2n],
    );
    const tenderlyish = {
      transaction: {
        status: false,
        error_message: "execution reverted",
        transaction_info: {
          call_trace: {
            error: "execution reverted",
            output: data, // the real revert bytes live here
            calls: [{ output: "0x", error: null }],
          },
        },
      },
    };
    const msg = decodeRevertFromResult(tenderlyish);
    expect(msg).toMatch(/slippage/i);
  });

  it("returns null when the payload has no decodable revert data", () => {
    const tenderlyish = {
      transaction: { status: false, error_message: "execution reverted" },
    };
    expect(decodeRevertFromResult(tenderlyish)).toBeNull();
  });

  it("ignores unrelated hex (addresses) and only decodes real reverts", () => {
    // An address is 0x + 40 hex; its leading 4 bytes won't match any error
    // selector, so it must not produce a false decode.
    const payload = { addr: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
    expect(decodeRevertFromResult(payload)).toBeNull();
  });
});
