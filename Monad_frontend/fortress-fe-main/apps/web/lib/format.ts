import { formatUnits } from "viem";

// Signed APY display — avoids a double "−" when a value is already negative.
export function formatApy(value: number, kind: "yield" | "cost"): {
  text: string;
  negative: boolean;
} {
  const negative = kind === "cost" || value < 0;
  return { text: `${negative ? "−" : ""}${Math.abs(value).toFixed(2)}%`, negative };
}

// Raw integer string (wei-style) → human-readable amount.
export function formatTokenAmount(amount: string, decimals = 18): string {
  try {
    const n = Number(formatUnits(BigInt(amount), decimals));
    if (!Number.isFinite(n)) return amount;
    if (n === 0) return "0";
    if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
    return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  } catch {
    return amount;
  }
}
