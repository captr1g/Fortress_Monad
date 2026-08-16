import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
const PT = "0x3623567972AD7f44242eC354A38bdBaCFC73Aa42" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WALLET = "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065";
const abi = [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
async function main() {
  const c = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const bal = await c.readContract({ address: PT, abi, functionName: "balanceOf", args: [WALLET as any] });
  console.log("PT balance:", bal.toString(), "=", (Number(bal) / 1e18).toFixed(6), "PT");
  const url = new URL("https://api-v2.pendle.finance/core/v2/sdk/8453/convert");
  url.searchParams.set("tokensIn", PT);
  url.searchParams.set("amountsIn", bal.toString());
  url.searchParams.set("tokensOut", USDC);
  url.searchParams.set("receiver", WALLET);
  url.searchParams.set("slippage", "0.02");
  url.searchParams.set("enableAggregator", "true");
  const res = await fetch(url.toString());
  console.log("Pendle status:", res.status);
  if (!res.ok) console.log("error:", (await res.text()).slice(0, 200));
  else { const j = (await res.json()) as any; console.log("expectedOut:", j.routes?.[0]?.outputs?.[0]?.amount); }
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
