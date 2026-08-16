/**
 * Discriminating test: does a STANDALONE Pendle SDK redeem (PT → USDC, receiver=user)
 * simulate cleanly for the wallet's exact PT balance?
 *
 *  - If YES → the redeem route works at this size; the FortVault adapter's internal
 *    redeem logic is the culprit for the "transfer exceeds balance @ 0x2ce6…" revert.
 *  - If NO  → the amount is simply too small to route through Pendle at all.
 *
 * Run: node --import tsx scripts/debug-pendle-redeem-standalone.ts
 */
import "dotenv/config";
import { createPublicClient, http, getAddress, type Address, type Hex } from "viem";
import { base } from "viem/chains";

const WALLET = "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065" as Address;
const PT: Address = "0x3623567972AD7f44242eC354A38bdBaCFC73Aa42";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PENDLE_ROUTER: Address = "0x888888888889758F76e7103c6CbF23ABbF58F946";
const CHAIN_ID = 8453;

const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "a", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "o", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

async function main() {
  const client = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const bal = (await client.readContract({ address: PT, abi: erc20Abi, functionName: "balanceOf", args: [WALLET] })) as bigint;
  console.log("PT balance:", bal.toString());

  const url = new URL(`https://api-v2.pendle.finance/core/v2/sdk/${CHAIN_ID}/convert`);
  url.searchParams.set("tokensIn", PT);
  url.searchParams.set("amountsIn", bal.toString());
  url.searchParams.set("tokensOut", USDC);
  url.searchParams.set("receiver", WALLET);
  url.searchParams.set("slippage", "0.02");
  url.searchParams.set("enableAggregator", "true");

  const res = await fetch(url.toString());
  if (!res.ok) {
    console.log("Pendle SDK error", res.status, (await res.text()).slice(0, 200));
    process.exit(0);
  }
  const json = (await res.json()) as any;
  const route = json.routes?.[0];
  if (!route?.tx?.data) {
    console.log("No route returned:", JSON.stringify(json).slice(0, 200));
    process.exit(0);
  }
  const to = getAddress(route.tx.to);
  const data = route.tx.data as Hex;
  console.log("Route: router=", to, "expected USDC out=", route.outputs?.[0]?.amount);

  const { encodeFunctionData } = await import("viem");
  const approveTx = {
    to: PT,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [to, (1n << 256n) - 1n] }),
    value: "0",
  };
  const simulations = [approveTx, { to, data, value: (route.tx.value ?? "0").toString() }].map((tx: any) => ({
    network_id: String(CHAIN_ID), from: WALLET, to: tx.to, input: tx.data,
    value: tx.value.toString(), save: false, save_if_fails: true, simulation_type: "full",
  }));
  const turl = `https://api.tenderly.co/api/v1/account/${process.env.TENDERLY_ACCOUNT_SLUG}/project/${process.env.TENDERLY_PROJECT_SLUG}/simulate-bundle`;
  const tres = await fetch(turl, {
    method: "POST", headers: { "X-Access-Key": process.env.TENDERLY_ACCESS_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ simulations }),
  });
  const tjson = (await tres.json()) as any;
  (tjson.simulation_results ?? []).forEach((r: any, i: number) => {
    const t = r.transaction;
    console.log(`sim ${i + 1}: ${t?.status ? "OK gas=" + t?.gas_used : "FAIL: " + t?.error_message + " @ " + t?.error_info?.address}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
