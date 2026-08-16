import type { FortressConfig } from "../utils/config.js";

export type LiFiSwapData = {
  callTo: `0x${string}`;
  approveTo: `0x${string}`;
  sendingAssetId: `0x${string}`;
  receivingAssetId: `0x${string}`;
  fromAmount: bigint;
  callData: `0x${string}`;
  requiresDeposit: boolean;
};

type LiFiQuoteResponse = {
  estimate: { toAmount: string };
  transactionRequest: { to: string; data: string; value: string };
};

export async function fetchLiFiSwapData(params: {
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: bigint;
  fromAddress: `0x${string}`;
  chainId: number;
  slippage: number;
  config: FortressConfig;
}): Promise<{ swapData: LiFiSwapData[]; expectedOut: bigint }> {
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(params.chainId));
  url.searchParams.set("toChain", String(params.chainId));
  url.searchParams.set("fromToken", params.fromToken);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("fromAmount", String(params.fromAmount));
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("slippage", String(params.slippage));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LiFi quote failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as LiFiQuoteResponse;
    const expectedOut = BigInt(json.estimate.toAmount);

    // Build SwapData struct matching ILiFi.LibSwap.SwapData
    const swapData: LiFiSwapData[] = [{
      callTo: json.transactionRequest.to as `0x${string}`,
      approveTo: params.config.lifiDiamond,
      sendingAssetId: params.fromToken,
      receivingAssetId: params.toToken,
      fromAmount: params.fromAmount,
      callData: json.transactionRequest.data as `0x${string}`,
      requiresDeposit: true,
    }];

    return { swapData, expectedOut };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLiFiBridgeData(params: {
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: bigint;
  fromAddress: `0x${string}`;
  toAddress: `0x${string}`;
  fromChainId: number;
  toChainId: number;
  slippage: number;
}): Promise<{ lifiData: `0x${string}`; expectedOut: bigint }> {
  const url = new URL("https://li.quest/v1/quote");
  url.searchParams.set("fromChain", String(params.fromChainId));
  url.searchParams.set("toChain", String(params.toChainId));
  url.searchParams.set("fromToken", params.fromToken);
  url.searchParams.set("toToken", params.toToken);
  url.searchParams.set("fromAmount", String(params.fromAmount));
  url.searchParams.set("fromAddress", params.fromAddress);
  url.searchParams.set("toAddress", params.toAddress);
  url.searchParams.set("slippage", String(params.slippage));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LiFi bridge quote failed (${res.status}): ${body}`);
    }

    const json = (await res.json()) as LiFiQuoteResponse;
    const expectedOut = BigInt(json.estimate.toAmount);
    const lifiData = json.transactionRequest.data as `0x${string}`;

    return { lifiData, expectedOut };
  } finally {
    clearTimeout(timeout);
  }
}
