import type { RegistryProtocol, RegistryMarket } from "@fortress/core";

export type Terminal = { label: string; action: "Deposit" | "Leverage" | "Swap"; sub: string };

// Reconstructs every real destination a protocol can resolve to, combining
// two parts of the registry response: the vault/market data on the protocol
// entry itself, plus (Morpho only) the shared Blue markets list, which is
// also used for Leverage Loop strategies and lives separately in the
// registry since it isn't protocol-specific.
export function buildTerminals(protocol: RegistryProtocol, markets: RegistryMarket[]): Terminal[] {
  const terminals: Terminal[] = [];

  if (protocol.kind === "routing") {
    terminals.push({ label: "No vault", action: "Swap", sub: "Routing only, funds pass through and never rest here." });
    return terminals;
  }

  if (protocol.pendleMarkets?.length) {
    protocol.pendleMarkets.forEach((m) => {
      terminals.push({ label: m.label, action: "Deposit", sub: "Fixed-yield market." });
    });
    return terminals;
  }

  if (protocol.vaultSymbol) {
    terminals.push({ label: protocol.vaultSymbol, action: "Deposit", sub: "The vault holding your funds." });
  }

  if (protocol.name === "Morpho") {
    markets.forEach((m) => {
      terminals.push({ label: m.label, action: "Leverage", sub: `${m.collateral} collateral, ${m.loan} loan.` });
    });
  }

  return terminals;
}

export const KIND_LABEL: Record<RegistryProtocol["kind"], string> = {
  variable: "Variable yield",
  fixed: "Fixed yield",
  routing: "Routing utility",
};

export const PROTOCOL_COPY: Record<string, { method: string; note?: string }> = {
  Morpho: {
    method: "Rate pulled live from Morpho's own API for the vault. Each Leverage market prices independently on-chain.",
    note: "Morpho does double duty here. mwUSDC is the plain-deposit vault, the markets below are separate Morpho Blue lending markets used only by Leverage Loop strategies, each one isolated so collateral and risk never cross between them.",
  },
  Aave: { method: "Rate read directly from Aave's on-chain reserve data, no third-party API involved." },
  Fluid: { method: "Rate sourced from Fluid's tracked DefiLlama pool." },
  Euler: { method: "Rate computed on-chain from share-price growth over the last week, no oracle, no third-party feed." },
  CompoundV3: { method: "Rate read directly from the Comet contract's live utilization curve." },
  Pendle: { method: "Rate is the market's implied yield to maturity, locked in the moment you deposit rather than floating." },
  LiFi: {
    method:
      "Never holds a deposit. It only wakes up to route a swap when your starting token isn't USDC, then hands off to whichever vault you picked.",
  },
};
