/**
 * Verify "Withdraw all from Pendle": build via the real CalldataBuilder (now the
 * direct Pendle Router path) and simulate the exact tx bundle it produces.
 *
 * Run: node --import tsx scripts/debug-pendle-withdraw.ts
 */
import "dotenv/config";
import {
  createPublicClient,
  http,
  decodeFunctionData,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { loadBaseConfig } from "../src/chains/evm/config/base.js";
import { CalldataBuilder } from "../src/chains/evm/contracts/vault-builder.js";
import { erc20Abi } from "../src/chains/evm/config/base_abi.js";

const WALLET = "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065" as Address;

async function main() {
  const config = loadBaseConfig();
  const client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
  const builder = new CalldataBuilder(config);

  const { transactions, description } = await builder.build(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { action: "withdraw" as const, entries: [{ protocol: "Pendle", amountType: "all" }] } as any,
    WALLET,
  );

  console.log(description, "| txs:", transactions.length);
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      const d = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      if (d.functionName === "approve") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [spender, amt] = d.args as any[];
        console.log(`  tx${i + 1}: approve(${spender}, ${amt}) on ${tx.to}`);
        continue;
      }
    } catch {
      /* not an approve */
    }
    console.log(`  tx${i + 1}: → ${tx.to} value=${tx.value} (router redeem)`);
  }

  const simulations = transactions.map((tx) => ({
    network_id: String(tx.chainId), from: WALLET, to: tx.to, input: tx.data,
    value: tx.value.toString(), save: false, save_if_fails: true, simulation_type: "full",
  }));
  const url = `https://api.tenderly.co/api/v1/account/${process.env.TENDERLY_ACCOUNT_SLUG}/project/${process.env.TENDERLY_PROJECT_SLUG}/simulate-bundle`;
  const res = await fetch(url, {
    method: "POST", headers: { "X-Access-Key": process.env.TENDERLY_ACCESS_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ simulations }),
  });
  const json = (await res.json()) as any;
  (json.simulation_results ?? []).forEach((r: any, i: number) => {
    const t = r.transaction;
    console.log(`sim ${i + 1}: ${t?.status ? "OK gas=" + t?.gas_used : "FAIL: " + t?.error_message + " @ " + t?.error_info?.address}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
