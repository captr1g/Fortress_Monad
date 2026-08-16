import { describe, it, expect } from "vitest";
import { z } from "zod";
import { fetchLiFiSwapData } from "@chains/evm/protocols/lifi/swap-resolver.js";
import { describeIntegration } from "../../helpers/integration.js";
import { TOKENS, WALLETS, BASE_CHAIN_ID, ONE_USDC } from "../../datasets/base.js";

// Contract: the LiFi /v1/quote response still carries estimate.toAmount and
// transactionRequest.{to,data}. fetchLiFiSwapData maps exactly these fields into
// the FortVault swapData; drift here silently breaks swapAndDeposit / leverage entry.

const SwapDataSchema = z.object({
  callTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  approveTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  callData: z.string().regex(/^0x[0-9a-fA-F]*$/),
  requiresDeposit: z.boolean(),
});

describeIntegration("contract: LiFi quote (Base USDC->WETH)", () => {
  it("returns a mappable swapData entry and a positive expected output", async () => {
    const { swapData, expectedOut } = await fetchLiFiSwapData({
      fromToken: TOKENS.USDC,
      toToken: TOKENS.WETH,
      fromAmount: ONE_USDC * 5n, // 5 USDC to comfortably route
      fromAddress: WALLETS.sample,
      chainId: BASE_CHAIN_ID,
      slippage: 0.005,
    });

    expect(swapData).toHaveLength(1);
    expect(() => SwapDataSchema.parse(swapData[0])).not.toThrow();
    expect(expectedOut).toBeGreaterThan(0n);
  });
});
