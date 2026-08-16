/**
 * Pendle PT Buy — End-to-End On-Chain Test (production-grade reference)
 *
 * Proves the full production path works with a real transaction:
 *   user → FortStrategyExecutor.executeStrategy → PendleStrategyAdapter → Pendle RouterV4
 *
 * Key production principles demonstrated here (to be ported to the backend):
 *   1. The adapter address is RESOLVED from the executor on-chain (getAdapter), never
 *      hardcoded. A stale/orphan address silently breaks the balance-delta check.
 *   2. The `receiver` in the Pendle SDK calldata MUST equal that resolved adapter, so
 *      PT lands where the adapter measures its balance delta.
 *   3. minPtOut is derived from the SDK's expected output and an explicit slippage
 *      bound — it is the real on-chain protection, independent of the baked calldata.
 *
 * Run: node --import tsx tests/pendle-e2e.ts
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  parseAbiParameters,
  formatUnits,
  getAddress,
  type Hex,
  type Address,
} from "viem";
import { monad } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// ─── Config ─────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.TEST_PRIVATE_KEY as Hex;
if (!PRIVATE_KEY) {
  throw new Error(
    "TEST_PRIVATE_KEY is not set. Use a throwaway test key — never a key holding real funds."
  );
}
const RPC_URL = process.env.RPC_MONAD!;
const PENDLE_CHAIN_ID = 143;

const EXECUTOR: Address = "0x09Acd25f4Cd57155C47edc4b82855b50Ba67ad0D";
const USDC: Address = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";

// Pendle market: 40acresUSDC (27 Aug 2026) — USDC-denominated, good liquidity, not expired.
const PT_TOKEN: Address = "0x3623567972AD7f44242eC354A38bdBaCFC73Aa42";

const PENDLE_ADAPTER_ID = 2;
const AMOUNT = 500_000n;        // 0.5 USDC (6 decimals)
const SLIPPAGE = 0.02;          // 2%

// ─── ABIs ───────────────────────────────────────────────────────────────────

const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const executorAbi = [
  { name: "getAdapter", type: "function", stateMutability: "view", inputs: [{ name: "adapterId", type: "uint8" }], outputs: [{ type: "address" }] },
  {
    name: "executeStrategy",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inputToken", type: "address" },
      { name: "inputAmount", type: "uint256" },
      {
        name: "steps", type: "tuple[]", components: [
          { name: "adapterId", type: "uint8" },
          { name: "action", type: "uint8" },
          { name: "tokenIn", type: "address" },
          { name: "bps", type: "uint16" },
          { name: "amountFixed", type: "uint256" },
          { name: "data", type: "bytes" },
        ]
      },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// ─── Pendle SDK ───────────────────────────────────────────────────────────────

/**
 * Fetches swap calldata from Pendle's Hosted SDK Convert API.
 * `receiver` MUST be the on-chain adapter that will hold PT for the balance-delta check.
 */
async function fetchPendlePtSwap(params: {
  receiver: Address;
  tokenIn: Address;
  amountIn: bigint;
  ptTokenOut: Address;
  slippage: number;
}): Promise<{ calldata: Hex; expectedPtOut: bigint }> {
  const url = new URL(`https://api-v2.pendle.finance/core/v2/sdk/${PENDLE_CHAIN_ID}/convert`);
  url.searchParams.set("tokensIn", params.tokenIn);
  url.searchParams.set("amountsIn", params.amountIn.toString());
  url.searchParams.set("tokensOut", params.ptTokenOut);
  url.searchParams.set("receiver", params.receiver);
  url.searchParams.set("slippage", params.slippage.toString());
  url.searchParams.set("enableAggregator", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Pendle SDK error (${res.status}): ${await res.text()}`);
    }
    const json = await res.json() as any;
    const route = json.routes?.[0];
    if (!route?.tx?.data) throw new Error("Pendle SDK returned no route");
    return {
      calldata: route.tx.data as Hex,
      expectedPtOut: BigInt(route.outputs[0].amount),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({ chain: monad, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: monad, transport: http(RPC_URL) });

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Pendle PT Buy — E2E (production path)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`Wallet:   ${account.address}`);
  console.log(`Executor: ${EXECUTOR}`);

  // 1) Resolve the adapter from the executor — the authoritative source of truth.
  const adapter = getAddress(await publicClient.readContract({
    address: EXECUTOR, abi: executorAbi, functionName: "getAdapter", args: [PENDLE_ADAPTER_ID],
  }) as Address);
  console.log(`Adapter (resolved from executor.getAdapter(${PENDLE_ADAPTER_ID})): ${adapter}`);

  // 2) Balances before.
  const usdcBefore = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptBefore = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptOnExecutorBefore = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [EXECUTOR] }) as bigint;
  console.log(`\n💰 Before: USDC=${formatUnits(usdcBefore, 6)}, PT(user)=${formatUnits(ptBefore, 18)}`);
  if (usdcBefore < AMOUNT) throw new Error(`Insufficient USDC (have ${formatUnits(usdcBefore, 6)})`);

  // 3) Pendle SDK calldata — receiver = resolved adapter.
  const { calldata: routerCalldata, expectedPtOut } = await fetchPendlePtSwap({
    receiver: adapter,
    tokenIn: USDC,
    amountIn: AMOUNT,
    ptTokenOut: PT_TOKEN,
    slippage: SLIPPAGE,
  });
  const minPtOut = (expectedPtOut * BigInt(Math.floor((1 - SLIPPAGE) * 10_000))) / 10_000n;
  console.log(`\n📡 Pendle SDK: expected PT=${formatUnits(expectedPtOut, 18)}, minPtOut=${formatUnits(minPtOut, 18)}`);

  // 4) Encode the adapter step data + the strategy step.
  const adapterData = encodeAbiParameters(
    parseAbiParameters("address, uint256, bool, bytes"),
    [PT_TOKEN, minPtOut, false, routerCalldata],
  );
  const steps = [{
    adapterId: PENDLE_ADAPTER_ID,
    action: 0, // ActionType.SWAP
    tokenIn: USDC,
    bps: 10_000,
    amountFixed: 0n,
    data: adapterData,
  }];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

  // 5) Approve USDC to the executor.
  const allowance = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [account.address, EXECUTOR] }) as bigint;
  if (allowance < AMOUNT) {
    console.log(`\n🔑 Approving USDC → executor...`);
    const tx = await walletClient.writeContract({ address: USDC, abi: erc20Abi, functionName: "approve", args: [EXECUTOR, AMOUNT * 100n] });
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }

  // 6) Simulate first (fail fast with a decoded reason), then execute.
  console.log(`\n🧪 Simulating executeStrategy...`);
  await publicClient.simulateContract({
    address: EXECUTOR, abi: executorAbi, functionName: "executeStrategy",
    args: [USDC, AMOUNT, steps, deadline], account: account.address,
  });
  console.log(`   Simulation OK`);

  console.log(`\n🚀 Executing on-chain...`);
  const tx = await walletClient.writeContract({
    address: EXECUTOR, abi: executorAbi, functionName: "executeStrategy",
    args: [USDC, AMOUNT, steps, deadline],
  });
  console.log(`   Tx: ${tx}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`   Status: ${receipt.status}, gas: ${receipt.gasUsed}`);

  // 7) Balances after.
  const usdcAfter = await publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptAfter = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }) as bigint;
  const ptOnExecutorAfter = await publicClient.readContract({ address: PT_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [EXECUTOR] }) as bigint;

  const usdcSpent = usdcBefore - usdcAfter;
  const ptToUser = ptAfter - ptBefore;
  const ptToExecutor = ptOnExecutorAfter - ptOnExecutorBefore;

  console.log(`\n💰 After:`);
  console.log(`   USDC spent:       ${formatUnits(usdcSpent, 6)}`);
  console.log(`   PT → user:        ${formatUnits(ptToUser, 18)}`);
  console.log(`   PT → executor:    ${formatUnits(ptToExecutor, 18)} (stranded if > 0)`);

  console.log(`\n═══════════════════════════════════════════════════════════`);
  if (receipt.status !== "success") {
    console.log(`❌ FAILED — tx reverted`);
    process.exit(1);
  }
  if (ptToUser > 0n) {
    console.log(`✅ SUCCESS — user received ${formatUnits(ptToUser, 18)} PT for ${formatUnits(usdcSpent, 6)} USDC`);
  } else if (ptToExecutor > 0n) {
    console.log(`⚠️  PARTIAL — swap worked but PT is stranded on the executor.`);
    console.log(`   The executor sweeps inputToken + each step.tokenIn, not step.tokenOut.`);
    console.log(`   Fine for the PT-loop (PT is consumed by the next supplyCollateral step),`);
    console.log(`   but a standalone buy-PT needs the output swept. See notes.`);
  } else {
    console.log(`❌ No PT produced anywhere — investigate.`);
    process.exit(1);
  }
  console.log(`═══════════════════════════════════════════════════════════\n`);
}

main().catch((err) => {
  console.error(`\n❌ ${err.shortMessage || err.message || err}`);
  process.exit(1);
});
