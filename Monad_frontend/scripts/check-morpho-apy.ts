import "dotenv/config";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const SECONDS_PER_YEAR = 31_536_000;
const SAMPLE_BLOCKS = 302_400n;
const abi = [{ name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] }] as const;

async function main() {
  const client = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const latest = await client.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCKS;
  const pastBlock = await client.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);

  // mwUSDC: 18-decimal share token, underlying is 6-decimal USDC
  // Must use 10^18 shares (= 1 full share) to get a meaningful USDC output
  const vault = "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca" as const;
  const ONE = 10n ** 18n; // 1 full share
  const now = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE] });
  const past = await client.readContract({ address: vault, abi, functionName: "convertToAssets", args: [ONE], blockNumber: pastNumber });
  console.log("Morpho mwUSDC: now=" + now.toString() + " past=" + past.toString());
  console.log("  overMAX_SAFE:", Number(now) > Number.MAX_SAFE_INTEGER);
  if (past > 0n && now > past) {
    const apy = (Number(now) / Number(past)) ** (SECONDS_PER_YEAR / elapsed) - 1;
    console.log("  APY = " + (apy * 100).toFixed(4) + "%");
  } else {
    console.log("  no growth");
  }
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
