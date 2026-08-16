// Base token address (lowercase) → display symbol + decimals for the dashboard.
const TOKENS: Record<string, { symbol: string; decimals: number }> = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": { symbol: "USDC", decimals: 6 },
    "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": { symbol: "USDbC", decimals: 6 },
    "0x4200000000000000000000000000000000000006": { symbol: "WETH", decimals: 18 },
    "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": { symbol: "cbETH", decimals: 18 },
    "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": { symbol: "cbBTC", decimals: 8 },
    "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": { symbol: "wstETH", decimals: 18 },
    "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a": { symbol: "weETH", decimals: 18 },
};

export function tokenSymbol(address: string): string {
    return TOKENS[address.toLowerCase()]?.symbol ?? `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAmount(raw: string, address: string, maxFrac = 4): string {
    const decimals = TOKENS[address.toLowerCase()]?.decimals ?? 18;
    const v = Number(raw) / 10 ** decimals;
    if (v === 0) return "0";
    if (v < 0.0001) return v.toExponential(2);
    return v.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
