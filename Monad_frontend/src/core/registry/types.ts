import type { Vm } from "@chains/types.js";

//Chains:-
export type TokenInfo = {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  stable?: boolean;
  inputEnabled?: boolean;
};

export type MarketInfo = {
  label: string;
  collateral: string;
  loan: string;
};

export type ChainInfo = {
  chainKey: string;
  chainId: number;
  vm: Vm;
  label: string;
  executable: boolean;
  tokens: TokenInfo[];
  markets: MarketInfo[];
  loanToken: string;
};

//Capabilities:-
export type Capability = {
  chainKey: string;
  domain: string;
  protocol: string;
  actions: string[];
  promptFragment?: string;
};
