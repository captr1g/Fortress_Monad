import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const VAULT = "0xf42f5795d9ac7e9d757db633d693cd548cfd9169" as const;
const abi = [
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const SECONDS_PER_YEAR = 31_536_000;
// ~7 days on Base (2s blocks)
const SAMPLE_BLOCKS = 302_400n;

async function main() {
  const c = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const latest = await c.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await c.getBlock({ blockNumber: pastNumber });

  const ONE = 10n ** 6n; // fUSDC decimals = 6
  const rateNow = await c.readContract({ address: VAULT, abi, functionName: "convertToAssets", args: [ONE] });
  const ratePast = await c.readContract({ address: VAULT, abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });

  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  const growth = Number(rateNow) / Number(ratePast) - 1;
  const apr = growth * (SECONDS_PER_YEAR / elapsed);
  const perSecond = growth / elapsed;
  const apy = Math.pow(1 + perSecond, SECONDS_PER_YEAR) - 1;

  console.log("block range:", pastNumber.toString(), "→", latest.number.toString());
  console.log("elapsed:", elapsed, "s (~" + (elapsed / 86400).toFixed(1) + " days)");
  console.log("rateNow:", rateNow.toString(), "ratePast:", ratePast.toString());
  console.log("growth:", (growth * 100).toFixed(6), "%");
  console.log("APR (simple):", (apr * 100).toFixed(4), "%");
  console.log("APY (compounded):", (apy * 100).toFixed(4), "%");
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
