// Lifi to swapData, bridgeData, unWindData

import type { Address } from "viem";
import type {
  LiFiQuoteResponse,
  LiFiSwapData,
  LiFiInput,
} from "@domains/yield/types/lifi";

type QuoteParams = {
  searchParams: Record<string, string>;
  timeoutMs: number;
  lifiApiKey?: string;
};

async function fetchQuote(params: QuoteParams): Promise<LiFiQuoteResponse> {
  const url = new URL("https://li.quest/v1/quote");
  for (const [key, value] of Object.entries(params.searchParams)) {
    url.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);
  const headers: Record<string, string> = {};
  if (params.lifiApiKey) headers["x-lifi-api-key"] = params.lifiApiKey;

  try {
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      headers,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`LiFi quote failed (${res.status}): ${body}`);
    }
    return (await res.json()) as LiFiQuoteResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveApiKey(input: LiFiInput): string | undefined {
  return input.lifiApiKey ?? input.config?.lifiApiKey;
}

export async function fetchLiFiSwapData(
  input: LiFiInput,
): Promise<{ swapData: LiFiSwapData[]; expectedOut: bigint }> {
  const json = await fetchQuote({
    searchParams: {
      fromChain: String(input.chainId),
      toChain: String(input.toChainId ?? input.chainId),
      fromToken: input.fromToken,
      toToken: input.toToken,
      fromAmount: String(input.fromAmount),
      fromAddress: input.fromAddress,
      slippage: String(input.slippage),
    },
    timeoutMs: 10_000,
    lifiApiKey: resolveApiKey(input),
  });

  const expectedOut = BigInt(json.estimate.toAmount);
  const swapData: LiFiSwapData[] = [
    {
      callTo: json.transactionRequest.to as Address,
      approveTo:
        input.config?.lifiDiamond ??
        (json.transactionRequest.to as Address),
      sendingAssetId: input.fromToken,
      receivingAssetId: input.toToken,
      fromAmount: input.fromAmount,
      callData: json.transactionRequest.data as Address,
      requiresDeposit: true,
    },
  ];

  return { swapData, expectedOut };
}

export async function fetchLiFiBridgeData(
  input: LiFiInput,
): Promise<{ lifiData: Address; expectedOut: bigint }> {
  const searchParams: Record<string, string> = {
    fromChain: String(input.chainId),
    toChain: String(input.toChainId ?? input.chainId),
    fromToken: input.fromToken,
    toToken: input.toToken,
    fromAmount: String(input.fromAmount),
    fromAddress: input.fromAddress,
    slippage: String(input.slippage),
  };
  if (input.toAddress) searchParams.toAddress = input.toAddress;

  const json = await fetchQuote({
    searchParams,
    timeoutMs: 15_000,
    lifiApiKey: resolveApiKey(input),
  });

  return {
    lifiData: json.transactionRequest.data as Address,
    expectedOut: BigInt(json.estimate.toAmount),
  };
}

export async function fetchLiFiUnwindQuote(
  input: LiFiInput,
): Promise<{
  dex: Address;
  calldata: Address;
  expectedOut: bigint;
}> {
  const json = await fetchQuote({
    searchParams: {
      fromChain: String(input.chainId),
      toChain: String(input.chainId),
      fromToken: input.fromToken,
      toToken: input.toToken,
      fromAmount: String(input.fromAmount),
      fromAddress: input.fromAddress,
      slippage: String(input.slippage),
    },
    timeoutMs: 10_000,
    lifiApiKey: resolveApiKey(input),
  });

  return {
    dex: json.transactionRequest.to as Address,
    calldata: json.transactionRequest.data as Address,
    expectedOut: BigInt(json.estimate.toAmount),
  };
}
