import type { EvmChainConfig } from "@chains/evm/types";

export type LiFiSwapData = {
  callTo: `0x${string}`;
  approveTo: `0x${string}`;
  sendingAssetId: `0x${string}`;
  receivingAssetId: `0x${string}`;
  fromAmount: bigint;
  callData: `0x${string}`;
  requiresDeposit: boolean;
};

export type LiFiQuoteResponse = {
  estimate: { toAmount: string };
  transactionRequest: { to: string; data: string; value: string };
};

export type LiFiInput = {
  fromToken: `0x${string}`;
  toToken: `0x${string}`;
  fromAmount: bigint;
  fromAddress: `0x${string}`;
  chainId: number;
  slippage: number;
  toAddress?: `0x${string}`;
  toChainId?: number;
  config?: EvmChainConfig;
  lifiApiKey?: string;
};
