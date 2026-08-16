/**
 * RIGOROUS precision audit of fetchErc4626OnchainApy.
 *
 * For each vault, compute the annualized 7-day share-growth APY three ways:
 *   A) production: ONE = 10^12, float ratio          (current code)
 *   B) native:     ONE = 10^decimals, float ratio
 *   C) exact:      ONE = 10^decimals, BigInt fixed-point ratio (ground truth)
 *
 * If A ≈ C for the vaults actually configured with erc4626-onchain (Fluid, Euler),
 * the production code is correct. We also test an 18-decimal-share vault (mwUSDC)
 * to expose whether 10^12 breaks there.
 */
import "dotenv/config";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";

const SECONDS_PER_YEAR = 31_536_000;
const SAMPLE_BLOCK_OFFSET = 302_400n;
const convertAbi = [
  { name: "convertToAssets", type: "function", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const VAULTS = [
  { name: "Fluid fUSDC   [erc4626-onchain]", addr: "0xf42f5795d9ac7e9d757db633d693cd548cfd9169" },
  { name: "Euler eeUSDC  [erc4626-onchain]", addr: "0x67f062a12f82c3b42d4ca7a35fb26cbaac28008b" },
  { name: "Morpho mwUSDC [NOT this path]  ", addr: "0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca" },
] as const;

async function main() {
  const client = createPublicClient({ chain: base, transport: http(process.env.RPC_BASE!) });
  const latest = await client.getBlock();
  const pastNumber = latest.number - SAMPLE_BLOCK_OFFSET;
  const pastBlock = await client.getBlock({ blockNumber: pastNumber });
  const elapsed = Number(latest.timestamp - pastBlock.timestamp);
  const exponent = SECONDS_PER_YEAR / elapsed;
  console.log(`elapsed = ${elapsed}s (${(elapsed / 86400).toFixed(3)} days), annualize exponent = ${exponent.toFixed(4)}\n`);

  for (const v of VAULTS) {
    const addr = v.addr as `0x${string}`;
    const decimals = (await client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" })) as number;

    async function conv(one: bigint, block?: bigint) {
      return (await client.readContract({
        address: addr, abi: convertAbi, functionName: "convertToAssets", args: [one],
        ...(block ? { blockNumber: block } : {}),
      })) as bigint;
    }

    // A) production: 10^12 float
    const a_now = await conv(10n ** 12n);
    const a_past = await conv(10n ** 12n, pastNumber);
    const A = a_past === 0n || a_now <= a_past ? null : (Number(a_now) / Number(a_past)) ** exponent - 1;

    // B) native decimals, float
    const one = 10n ** BigInt(decimals);
    const b_now = await conv(one);
    const b_past = await conv(one, pastNumber);
    const B = b_past === 0n || b_now <= b_past ? null : (Number(b_now) / Number(b_past)) ** exponent - 1;

    // C) native decimals, BigInt fixed-point ratio (WAD-scaled) = ground truth
    const WAD = 10n ** 18n;
    const ratioWad = b_past === 0n ? 0n : (b_now * WAD) / b_past;
    const C = ratioWad === 0n ? null : (Number(ratioWad) / 1e18) ** exponent - 1;

    // D) ROBUST candidate: probe = 1e6 whole shares (10^decimals * 1e6), BigInt ratio.
    //    Large numerator kills the vault's internal truncation error; BigInt avoids
    //    float overflow for high-value vaults; works for any decimals.
    const probe = 10n ** BigInt(decimals) * 1_000_000n;
    const d_now = await conv(probe);
    const d_past = await conv(probe, pastNumber);
    const WAD2 = 10n ** 18n;
    const ratioWad2 = d_past === 0n ? 0n : (d_now * WAD2) / d_past;
    const D = ratioWad2 === 0n || d_now <= d_past ? null : (Number(ratioWad2) / 1e18) ** exponent - 1;

    const fmt = (x: number | null) => (x === null ? "NULL" : (x * 100).toFixed(6) + "%");
    console.log(`${v.name}  decimals=${decimals}`);
    console.log(`   A) 10^12 float       : ${fmt(A)}   (now=${a_now} past=${a_past})`);
    console.log(`   B) 10^dec float      : ${fmt(B)}   (now=${b_now} past=${b_past})`);
    console.log(`   C) 10^dec BigInt     : ${fmt(C)}`);
    console.log(`   D) 1e6-share BigInt  : ${fmt(D)}   <-- robust candidate`);
    const drift = A !== null && D !== null ? Math.abs(A - D) * 100 : null;
    console.log(`   A vs D drift         : ${drift === null ? "N/A (A NULL)" : drift.toFixed(6) + " pp"}\n`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
