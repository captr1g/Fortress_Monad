import { describe, it, expect } from "vitest";
import { encodeFunctionData, decodeFunctionData, type Address } from "viem";
import { strategyExecutorAbi } from "@chains/evm/config/abi.js";

// Validates that the ABI encodes the sweepTokens parameter correctly and that
// the produced calldata is decodable with the updated 5-arg signature.

describe("strategyExecutorAbi — sweepTokens encoding", () => {
  const inputToken = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603" as Address;
  const inputAmount = 1_000_000n;
  const deadline = 9999999999n;

  it("encodes executeStrategy with an empty sweepTokens array", () => {
    const data = encodeFunctionData({
      abi: strategyExecutorAbi,
      functionName: "executeStrategy",
      args: [
        inputToken,
        inputAmount,
        [{ adapterId: 0, action: 0, tokenIn: inputToken, bps: 10000, amountFixed: 0n, data: "0x" }],
        [], // sweepTokens
        deadline,
      ],
    });
    expect(data).toBeDefined();
    expect(data.startsWith("0x")).toBe(true);

    // Round-trip decode to verify the parameter is in the correct position
    const decoded = decodeFunctionData({ abi: strategyExecutorAbi, data });
    expect(decoded.functionName).toBe("executeStrategy");
    expect(decoded.args[3]).toEqual([]); // sweepTokens at index 3
    expect(decoded.args[4]).toBe(deadline); // deadline at index 4
  });

  it("encodes executeStrategy with multiple sweep tokens", () => {
    const sweep = [
      "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
      "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242",
    ] as Address[];

    const data = encodeFunctionData({
      abi: strategyExecutorAbi,
      functionName: "executeStrategy",
      args: [
        inputToken,
        inputAmount,
        [{ adapterId: 1, action: 2, tokenIn: inputToken, bps: 0, amountFixed: 0n, data: "0x" }],
        sweep,
        deadline,
      ],
    });

    const decoded = decodeFunctionData({ abi: strategyExecutorAbi, data });
    expect(decoded.args[3]).toEqual(sweep);
  });

  it("places sweepTokens between steps and deadline (position 3)", () => {
    // The old ABI had deadline at index 3. Verify the new ABI shifts it to index 4.
    const data = encodeFunctionData({
      abi: strategyExecutorAbi,
      functionName: "executeStrategy",
      args: [
        inputToken,
        inputAmount,
        [],
        ["0x0000000000000000000000000000000000000001" as Address],
        42n,
      ],
    });

    const decoded = decodeFunctionData({ abi: strategyExecutorAbi, data });
    // args: [inputToken, inputAmount, steps, sweepTokens, deadline]
    expect(decoded.args.length).toBe(5);
    expect(decoded.args[3]).toEqual(["0x0000000000000000000000000000000000000001"]);
    expect(decoded.args[4]).toBe(42n);
  });
});
