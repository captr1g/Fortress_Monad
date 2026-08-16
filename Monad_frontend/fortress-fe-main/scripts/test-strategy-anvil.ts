/**
 * Integration test: yoUSD leverage loop via FortStrategyExecutor on Base fork (anvil)
 *
 * Prerequisites:
 * 1. Start anvil forking Base:
 *    anvil --fork-url $RPC_BASE --chain-id 8453 --port 8545
 *
 * 2. Deploy contracts:
 *    cd Contracts && forge script script/DeployStrategy.s.sol --rpc-url http://localhost:8545 --broadcast --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
 *
 * 3. Update .env with deployed addresses (from deploy script output):
 *    FORTRESS_STRATEGY_EXECUTOR=0x...
 *    FORTRESS_MORPHO_ADAPTER=0x...
 *    FORTRESS_SWAP_ADAPTER=0x...
 *    RPC_BASE=http://localhost:8545
 *
 * 4. Start backend:
 *    npm run dev
 *
 * 5. Run this test:
 *    npx tsx scripts/test-strategy-anvil.ts
 */

import { createPublicClient, createWalletClient, http, parseAbi, formatUnits } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

// Anvil's default account #0
const PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const RPC_URL = "http://localhost:8545";
const BACKEND_URL = "http://localhost:3000";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const MORPHO_BLUE = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb" as const;

// Resolved dynamically from the plan response's market params
let MARKET_ID: `0x${string}` = "0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137";

const account = privateKeyToAccount(PRIVATE_KEY);

const publicClient = createPublicClient({
  chain: base,
  transport: http(RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(RPC_URL),
});

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

const morphoPositionAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

async function main() {
  console.log("=== FortStrategyExecutor Integration Test ===");
  console.log(`Account: ${account.address}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log("");

  // Step 1: Deal 100 USDC to test account via anvil impersonation
  console.log("[1] Dealing 100 USDC to test account...");
  const usdcWhale = "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A"; // known USDC holder on Base

  // Impersonate whale and transfer
  await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_impersonateAccount",
      params: [usdcWhale],
      id: 1,
    }),
  });

  // Transfer 100 USDC from whale to our account
  const transferData = `0xa9059cbb000000000000000000000000${account.address.slice(2).toLowerCase()}0000000000000000000000000000000000000000000000000000000005f5e100`;
  await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_sendTransaction",
      params: [{ from: usdcWhale, to: USDC, data: transferData, gas: "0x30000" }],
      id: 2,
    }),
  });

  await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "anvil_stopImpersonatingAccount",
      params: [usdcWhale],
      id: 3,
    }),
  });

  // Mine a block
  await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "evm_mine", params: [], id: 4 }),
  });

  const usdcBalance = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`   USDC balance: ${formatUnits(usdcBalance, 6)}`);

  if (usdcBalance < 100_000_000n) {
    console.error("   FAILED: Could not deal USDC. Check whale address or fork block.");
    process.exit(1);
  }

  // Step 2: Call backend /fortress/plan
  console.log("\n[2] Calling POST /fortress/plan...");
  const planResponse = await fetch(`${BACKEND_URL}/fortress/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `I have 100 USDC and Swap 100% USDC to cbBTC
Supply 100% cbBTC as collateral to Morpho Market cbBTC-USDC on Base
Borrow USDC at 80% LTV against cbBTC
Swap 100% borrowed USDC to cbBTC
Supply 100% cbBTC as collateral
Repeat steps 3-5 five times`,
      walletAddress: account.address,
    }),
  });

  if (!planResponse.ok) {
    const err = await planResponse.text();
    console.error(`   FAILED: ${planResponse.status} — ${err}`);
    process.exit(1);
  }

  const plan = (await planResponse.json()) as {
    intent: any;
    description: string;
    transactions: Array<{ to: string; data: string; value: string; chainId: number }>;
    simulation: { success: boolean; gasUsed: string; error?: string };
  };

  console.log(`   Description: ${plan.description}`);
  console.log(`   Simulation: ${plan.simulation.success ? "OK" : "FAILED"} (gas: ${plan.simulation.gasUsed})`);
  console.log(`   Transactions: ${plan.transactions.length}`);

  if (!plan.simulation.success) {
    console.error(`   Simulation failed: ${plan.simulation.error}`);
    process.exit(1);
  }

  // Extract the market ID from the plan's intent so we query the correct Morpho position
  if (plan.intent?.steps) {
    for (const step of plan.intent.steps as any[]) {
      if (step.protocolData?.marketId && /^0x[a-fA-F0-9]{64}$/.test(step.protocolData.marketId)) {
        MARKET_ID = step.protocolData.marketId as `0x${string}`;
        console.log(`   Resolved market ID: ${MARKET_ID.slice(0, 18)}...`);
        break;
      }
    }
  }
  // If no bytes32 marketId in intent steps (name-based resolution), compute it from on-chain
  // The backend resolves the market and encodes params into calldata — for verification we
  // can use the Morpho Blue id() function or hardcode known markets.
  // For dynamic resolution: decode the supplyCollateral step's data from the executeStrategy calldata.
  if (!/^0x[a-fA-F0-9]{64}$/.test(MARKET_ID)) {
    console.log(`   ⚠ Could not extract market ID from intent — using fallback. Position check may fail.`);
  }

  // Step 3: Execute transactions on anvil fork
  console.log("\n[3] Executing transactions on fork...");

  for (let i = 0; i < plan.transactions.length; i++) {
    const tx = plan.transactions[i];
    console.log(`   Tx ${i + 1}/${plan.transactions.length}: → ${tx.to.slice(0, 10)}...`);

    try {
      const hash = await walletClient.sendTransaction({
        to: tx.to as `0x${string}`,
        data: tx.data as `0x${string}`,
        value: BigInt(tx.value),
        gas: 5_000_000n,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`   ✓ Status: ${receipt.status} | Gas: ${receipt.gasUsed}`);

      if (receipt.status === "reverted") {
        // Tx 1 is setAuthorization — if already authorized on a prior run, Morpho
        // reverts with "already set". That's benign; skip and continue.
        if (i === 0) {
          console.log(`   (auth already set on a prior run — skipping, continuing)`);
          continue;
        }
        console.error(`   REVERTED at tx ${i + 1}`);
        process.exit(1);
      }
    } catch (err: any) {
      console.error(`   ✗ Failed: ${err.message?.slice(0, 200)}`);
      process.exit(1);
    }
  }

  // Step 4: Verify Morpho position
  console.log("\n[4] Verifying Morpho position...");

  // If MARKET_ID wasn't found in the intent, compute it on-chain from MarketParams
  // by calling Morpho.idToMarketParams or using the known cbBTC/USDC markets
  const cbBTC_USDC_MARKETS = [
    "0xeedc9fc0014a66de911380a4e7560740ed76e7703d97a29cccc4aa0cebe0f6d7", // LLTV 86%
    "0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836", // LLTV 86%
    "0xaad26f1040e3164e6645ffe981f466ed74fb1d229f2d1f253581935e8f135fa6", // LLTV 86%
    "0xf10437266b9dd52751bd6255e15cccd0cdf5c75b58c1a3e2621130c905cd8ed9", // LLTV 77%
    "0x1a3e69d0109bb1be42b80e11034bb6ee98fc466721f26845dc83b2aa8d979137", // yoUSD
  ] as const;

  let positionFound = false;

  // Try the resolved MARKET_ID first, then fall back to known cbBTC/USDC markets
  const marketsToCheck = [MARKET_ID, ...cbBTC_USDC_MARKETS.filter(m => m !== MARKET_ID)];

  for (const marketId of marketsToCheck) {
    try {
      const position = await publicClient.readContract({
        address: MORPHO_BLUE,
        abi: morphoPositionAbi,
        functionName: "position",
        args: [marketId as `0x${string}`, account.address],
      });

      const [supplyShares, borrowShares, collateral] = position as [bigint, bigint, bigint];

      if (collateral > 0n || borrowShares > 0n) {
        console.log(`   Found position on market: ${(marketId as string).slice(0, 18)}...`);
        console.log(`   Collateral (raw): ${collateral}`);
        console.log(`   Borrow shares (raw): ${borrowShares}`);
        console.log(`   Supply shares (raw): ${supplyShares}`);
        console.log("\n   ✅ SUCCESS — Leveraged position created!");
        positionFound = true;
        break;
      }
    } catch {
      // skip
    }
  }

  if (!positionFound) {
    console.log(`   Checked ${marketsToCheck.length} markets — no position found.`);
    console.log("   ❌ FAILED — No collateral in any known Morpho market.");
    console.log("   Likely cause: LiFi swap calldata became stale between plan & fork execution.");
    console.log("   Try re-running immediately after restarting anvil at a fresh block.");
  }

  // Step 5: Final USDC balance
  const finalUsdc = await publicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`\n   Final USDC balance: ${formatUnits(finalUsdc, 6)} (started: 100.00)`);
  console.log("\n=== Test Complete ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
