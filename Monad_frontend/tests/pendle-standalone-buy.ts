/**
 * Pendle standalone PT buy — direct Router call (features 1-4 reference)
 *
 * For a standalone "buy PT / YT / LP with input token" the cleanest production path
 * is a DIRECT Pendle RouterV4 call with receiver = user. No executor, no adapter, no
 * stranding — the SDK handles routing/approximation/limit-orders and the user gets the
 * output token directly. This is the reference the backend will port for features 1-4.
 *
 * (The atomic PT-LOOP — buy PT → supply to Morpho → borrow → repeat — is the separate
 *  executor + PendleStrategyAdapter path, where PT is consumed by each supply step.)
 *
 * Run: node --import tsx tests/pendle-standalone-buy.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  getAddress,
  type Hex,
  type Address,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PRIVATE_KEY = "0x20832bda2467a00d62e8d6109be56bd19d835ca90a108f4040089ac25a0779dd";
const RPC_URL = process.env.RPC_BASE!;
const PENDLE_CHAIN_ID = 8453;

const PENDLE_ROUTER: Address = "0x888888888889758F76e7103c6CbF23ABbF58F946";
const USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

// 40acresUSDC (27 Aug 2026) PT — USDC-denominated, good liquidity, not expired.
const PT_TOKEN: Address = "0x3623567972AD7f44242eC354A38bdBaCFC73Aa42";

const AMOUNT = 500_000n;   // 0.5 USDC
const SLIPPAGE = 0.02;

const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/** Pendle SDK Convert API — receiver = user for a standalone buy. */
async function fetchPendleBuy(params: {
  receiver: Address; tokenIn: Address; amountIn: bigint; tokenOut: Address; slippage: number;
}): Promise<{ to: Address; data: Hex; value: bigint; expectedOut: bigint }> {
  const url = new URL(`https://api-v2.pendle.finance/core/v2/sdk/${PENDLE_CHAIN_ID}/convert`);
  url.searchParams.set("tokensIn", params.tokenIn);
  url.searchParams.set("amountsIn", params.amountIn.toString());
  url.searchParams.set("tokensOut", params.tokenOut);
  url.searchParams.set("receiver", params.receiver);
  url.searchParams.set("slippage", params.slippage.toString());
  url.searchParams.set("enableAggregator", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) throw new Error(`Pendle SDK (${res.status}): ${await res.text()}`);
    const json = await res.json() as any;
    const route = json.routes?.[0];
    if (!route?.tx?.data) throw new Error("no route");
    return {
      to: getAddress(route.tx.to),
      data: route.tx.data as Hex,
      value: BigInt(route.tx.value ?? 0),
      expectedOut: BigInt(route.outputs[0].amount),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: base, transport: http(RPC_URL) });

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Pendle standalone PT buy — direct Router (receiver = user)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Wallet: ${account.address}`);

  const usdcBefore = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptBefore = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  console.log(`\n💰 Before: USDC=${formatUnits(usdcBefore, 6)}, PT=${formatUnits(ptBefore, 18)}`);
  if (usdcBefore < AMOUNT) throw new Error(`Insufficient USDC (have ${formatUnits(usdcBefore, 6)})`);

  const { to, data, value, expectedOut } = await fetchPendleBuy({
    receiver: account.address, tokenIn: USDC, amountIn: AMOUNT, tokenOut: PT_TOKEN, slippage: SLIPPAGE,
  });
  console.log(`\n📡 Pendle SDK: router=${to}, expected PT=${formatUnits(expectedOut, 18)}`);

  // Approve USDC → Pendle Router.
  const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, PENDLE_ROUTER] }) as bigint;
  if (allowance < AMOUNT) {
    console.log(`\n🔑 Approving USDC → Pendle Router...`);
    const tx = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [PENDLE_ROUTER, AMOUNT * 100n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  console.log(`\n🚀 Executing swap on-chain...`);
  const tx = await walletClient.sendTransaction({ to, data, value });
  console.log(`   Tx: ${tx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`   Status: ${receipt.status}, gas: ${receipt.gasUsed}`);

  const usdcAfter = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptAfter = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;

  console.log(`\n💰 After: USDC=${formatUnits(usdcAfter, 6)}, PT=${formatUnits(ptAfter, 18)}`);
  console.log(`\n═══════════════════════════════════════════════════════════`);
  const ptGained = ptAfter - ptBefore;
  if (receipt.status === "success" && ptGained > 0n) {
    console.log(`✅ SUCCESS — user received ${formatUnits(ptGained, 18)} PT for ${formatUnits(usdcBefore - usdcAfter, 6)} USDC`);
  } else {
    console.log(`❌ FAILED`);
    process.exit(1);
  }
  console.log(`═══════════════════════════════════════════════════════════\n`);
}

main().catch((err) => { console.error(`\n❌ ${err.shortMessage || err.message || err}`); process.exit(1); });
