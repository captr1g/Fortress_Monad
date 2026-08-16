import { describe, it, expect } from "vitest";
import { encodeFunctionData, decodeFunctionData, type Address } from "viem";
import { crossChainRouterAbi, fortVaultFeeAbi } from "@chains/evm/config/abi.js";

describe("crossChainRouterAbi — getWithdrawRequest includes minAcceptableAmount", () => {
  it("has 7 fields in the output tuple (including minAcceptableAmount)", () => {
    const fn = crossChainRouterAbi.find((f) => f.name === "getWithdrawRequest");
    expect(fn).toBeDefined();
    const outputTuple = fn!.outputs[0];
    expect(outputTuple.type).toBe("tuple");
    expect(outputTuple.components).toHaveLength(7);

    const fieldNames = outputTuple.components.map((c: { name: string }) => c.name);
    expect(fieldNames).toEqual([
      "user",
      "expectedAmount",
      "actualAmount",
      "minAcceptableAmount",
      "sourceChainId",
      "timestamp",
      "status",
    ]);
  });

  it("minAcceptableAmount is uint256 at position 3", () => {
    const fn = crossChainRouterAbi.find((f) => f.name === "getWithdrawRequest");
    const field = fn!.outputs[0].components[3];
    expect(field.name).toBe("minAcceptableAmount");
    expect(field.type).toBe("uint256");
  });
});

describe("crossChainRouterAbi — depositCrossChain has 5 inputs including destReceiver", () => {
  it("encodes depositCrossChain correctly", () => {
    const data = encodeFunctionData({
      abi: crossChainRouterAbi,
      functionName: "depositCrossChain",
      args: [
        1_000_000n,
        1n, // destChainId = Ethereum
        "0x9a4458da219a6e93f80cf81Fea901053D74F1a02" as Address, // destReceiver
        "0xabcdef" as Address, // lifiData
        1700000000n, // deadline
      ],
    });
    expect(data.startsWith("0x")).toBe(true);

    const decoded = decodeFunctionData({ abi: crossChainRouterAbi, data });
    expect(decoded.functionName).toBe("depositCrossChain");
    expect(decoded.args[0]).toBe(1_000_000n);
    expect(decoded.args[1]).toBe(1n);
    expect((decoded.args[2] as string).toLowerCase()).toBe(
      "0x9a4458da219a6e93f80cf81Fea901053D74F1a02".toLowerCase()
    );
  });
});

describe("fortVaultFeeAbi — depositFeeBps view function", () => {
  it("has the correct shape (no inputs, uint16 output)", () => {
    const fn = fortVaultFeeAbi[0];
    expect(fn.name).toBe("depositFeeBps");
    expect(fn.stateMutability).toBe("view");
    expect(fn.inputs).toHaveLength(0);
    expect(fn.outputs).toHaveLength(1);
    expect(fn.outputs[0].type).toBe("uint16");
  });
});
