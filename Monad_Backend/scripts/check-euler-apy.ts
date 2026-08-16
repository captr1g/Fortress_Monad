import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Euler Earn USDC on Base (eeUSDC) — 6 decimals
const VAULT = "0x67f062a12f82c3b42d4ca7a35fb26cbaac28008b" as const;
const abi = [
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const SECONDS_PER_YEAR = 31_536_000;
const SAMPLE_BLOCKS = 302_400n; // ~7 days on Base (2s blocks)

async function main() {
  const c = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const latest = await c.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await c.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  console.log("block range:", pastNumber.toString(), "→", latest.number.toString());
  console.log("elapsed:", elapsed, "s (~" + (elapsed / 86400).toFixed(1) + " days)");

  for (const exp of [6n, 12n, 18n]) {
    const ONE = 10n ** exp;
    const now = await c.readContract({ address: VAULT, abi, functionName: "convertToAssets", args: [ONE] });
    const past = await c.readContract({ address: VAULT, abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });
    const overMax = Number(now) > Number.MAX_SAFE_INTEGER;
    const apy = (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
    console.log(`10^${exp}: now=${now} past=${past} overMAX_SAFE=${overMax} APY=${(apy * 100).toFixed(4)}%`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
