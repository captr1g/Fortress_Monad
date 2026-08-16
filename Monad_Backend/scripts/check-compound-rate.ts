import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
const COMET = "0xb125E6687d4313864e53df431d5425969c15Eb2F" as const;
const abi = [
  { name: "getUtilization", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getSupplyRate", type: "function", stateMutability: "view", inputs: [{ name: "utilization", type: "uint256" }], outputs: [{ type: "uint64" }] },
] as const;
async function main() {
  const c = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const util = await c.readContract({ address: COMET, abi, functionName: "getUtilization" });
  const rate = await c.readContract({ address: COMET, abi, functionName: "getSupplyRate", args: [util] });
  const perSec = Number(rate) / 1e18;
  const SECONDS = 31_536_000;
  const apy = Math.pow(1 + perSec, SECONDS) - 1;
  const apr = perSec * SECONDS;
  console.log("utilization:", (Number(util) / 1e18 * 100).toFixed(2), "%");
  console.log("ratePerSecond (raw):", rate.toString());
  console.log("APR (simple):", (apr * 100).toFixed(4), "%");
  console.log("APY (compounded):", (apy * 100).toFixed(4), "%");
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
