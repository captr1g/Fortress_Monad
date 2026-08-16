import "dotenv/config";
import { createPublicClient, http, type Address } from "viem";
import { base } from "viem/chains";
import { loadBaseConfig } from "../src/chains/evm/config/base.js";

async function main() {
  const config = loadBaseConfig();
  const client = createPublicClient({ chain: base, transport: http(config.rpcUrl) });
  const wallets: Address[] = [
    "0x24d593016eFcF6B43871A703300812a3271dD638",
    "0xa087e5b3fd517bC0cE2b93E4FD2D9F004bEd8065",
  ];
  for (const w of wallets) {
    const code = await client.getCode({ address: w });
    if (code && code.toLowerCase().startsWith("0xef0100")) {
      const delegate = "0x" + code.slice(8); // strip 0xef0100 prefix
      console.log(w, "=> EIP-7702 delegated →", delegate);
    } else {
      console.log(w, "=>", code && code !== "0x" ? `CONTRACT (${code.length} chars): ${code.slice(0, 20)}…` : "EOA (no code)");
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
