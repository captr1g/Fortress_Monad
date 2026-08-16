/**
 * Scans every env file that can reach the backend and reports chain values left
 * over from the Base deployment.
 *
 * boot.ts already refuses to start on a cross-chain config, but its error can
 * only report the RESOLVED value — it has no idea which of several layered
 * files supplied it. Under Docker the layering is
 * deploy/local-defaults.env -> ./.env -> Monad_Backend/.env, so "fix your .env"
 * is genuinely ambiguous. This finds the file.
 *
 *   npm run doctor:env          report only
 *   npm run doctor:env -- --fix comment the stale lines out (writes a .bak)
 */

import fs from "node:fs";
import path from "node:path";

const MONAD_CHAIN_IDS = new Set(["143", "10143"]);

// Verified against live Monad RPC — Monad_Contract/Fortress/ADDRESSES.md §2 and
// DEPLOYMENT.md §1. These are the values the code already defaults to, so the
// simplest correct .env is one that sets none of them.
const MONAD_DEFAULTS: Record<string, string> = {
  FORTRESS_CHAIN_ID: "143",
  FORTRESS_VAULT: "0x252709C4569E096BD4babe3be9175Ca2F49f152F",
  FORTRESS_SWAP_ROUTER: "0x220C82bF47cD376f9B71d038Ca45aC6E98482CC0",
  FORTRESS_CROSS_CHAIN_ROUTER: "0x64b65CF8469bcdb81D8621Cbc4e2F2B36D4f39EE",
  FORTRESS_USDC: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  FORTRESS_LIFI_DIAMOND: "0x026F252016A7C47CDEf1F05a3Fc9E20C92a49C37",
  FORTRESS_MORPHO_BLUE: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
  FORTRESS_PENDLE_ROUTER: "0x888888888889758F76e7103c6CbF23ABbF58F946",
  AAVE_POOL_MONAD: "0x69a5F9AD4f96ebf0a0C792dD42a01cC5C0102fef",
  RPC_MONAD: "https://rpc.monad.xyz",
};

// Every one of these returned empty bytecode from eth_getCode on chain 143.
const BASE_ADDRESSES: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC (Base)",
  "0x4200000000000000000000000000000000000006": "WETH (Base predeploy)",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca": "USDbC (Base)",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22": "cbETH (Base)",
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": "cbBTC (Base)",
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LI.FI diamond (Base)",
  "0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb": "Morpho Blue (Base)",
  "0xa238dd80c259a72e81d7e4664a9801593f98d1c5": "Aave V3 Pool (Base)",
  "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "AERO (Base)",
};

// Variables the backend no longer reads at all.
const DEAD_VARS: Record<string, string> = {
  RPC_BASE: "removed from the env schema — the backend only reads RPC_MONAD",
  RPC_ETH: "removed from the env schema",
  RPC_ARB: "removed from the env schema",
  RPC_BASE_SEPOLIA: "removed from the env schema",
  AAVE_POOL_BASE: "renamed to AAVE_POOL_MONAD",
  FORTRESS_MONAD_CHAIN_ID: "never read; use FORTRESS_CHAIN_ID",
  FORTRESS_MONAD_VAULT: "never read; use FORTRESS_VAULT",
  FORTRESS_MONAD_STRATEGY_EXECUTOR: "never read; use FORTRESS_STRATEGY_EXECUTOR",
  FORTRESS_MONAD_SWAP_ROUTER: "never read; use FORTRESS_SWAP_ROUTER",
  FORTRESS_MONAD_USDC: "never read; use FORTRESS_USDC",
  FORTRESS_MONAD_WMON: "never read",
  FORTRESS_MONAD_LIFI_DIAMOND: "never read; use FORTRESS_LIFI_DIAMOND",
};

type Finding = { line: number; key: string; value: string; problem: string; fix: string };

function scan(file: string): Finding[] {
  const findings: Finding[] = [];
  const lines = fs.readFileSync(file, "utf8").split("\n");

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) return;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    const value = rest.join("=").trim();

    if (DEAD_VARS[key]) {
      findings.push({
        line: i + 1, key, value,
        problem: DEAD_VARS[key],
        fix: "delete this line",
      });
      return;
    }

    if (key === "FORTRESS_CHAIN_ID" && value && !MONAD_CHAIN_IDS.has(value)) {
      findings.push({
        line: i + 1, key, value,
        problem: `chain ${value} is not Monad`,
        fix: "FORTRESS_CHAIN_ID=143",
      });
      return;
    }

    const known = BASE_ADDRESSES[value.toLowerCase()];
    if (known) {
      findings.push({
        line: i + 1, key, value,
        problem: `${known} — no contract at this address on chain 143`,
        fix: MONAD_DEFAULTS[key] ? `${key}=${MONAD_DEFAULTS[key]}` : "delete this line",
      });
    }
  });

  return findings;
}

function main(): void {
  const fix = process.argv.includes("--fix");
  const root = path.resolve(import.meta.dirname, "..", "..");

  // Mirrors the backend service's env_file list in docker-compose.yml, plus the
  // plain `npm run dev` case. Order is lowest to highest precedence.
  const candidates = [
    path.join(root, "deploy", "local-defaults.env"),
    path.join(root, ".env"),
    path.join(root, "Monad_Backend", ".env"),
    path.resolve(import.meta.dirname, "..", ".env"),
  ].filter((p, i, a) => a.indexOf(p) === i);

  let total = 0;
  let anyFile = false;

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    anyFile = true;
    const findings = scan(file);
    const rel = path.relative(root, file) || file;

    if (findings.length === 0) {
      console.log(`✓ ${rel} — no stale chain values`);
      continue;
    }

    total += findings.length;
    console.log(`\n✗ ${rel} — ${findings.length} stale value(s)`);
    for (const f of findings) {
      console.log(`   line ${f.line}: ${f.key}=${f.value || "(empty)"}`);
      console.log(`     ${f.problem}`);
      console.log(`     fix: ${f.fix}`);
    }

    if (fix) {
      const backup = `${file}.bak`;
      fs.copyFileSync(file, backup);
      const lines = fs.readFileSync(file, "utf8").split("\n");
      for (const f of findings) {
        lines[f.line - 1] = `# [monad-port] was: ${lines[f.line - 1]}`;
      }
      fs.writeFileSync(file, lines.join("\n"));
      console.log(`   → commented out; backup at ${path.relative(root, backup)}`);
    }
  }

  if (!anyFile) {
    console.log("No env files found. The backend will use the verified Monad");
    console.log("defaults compiled into src/chains/evm/config/monad.ts.");
    return;
  }

  if (total === 0) {
    console.log("\nAll clear.");
    return;
  }

  console.log(`\n${total} stale value(s) across the files above.`);
  if (!fix) {
    console.log("Re-run with --fix to comment them out (a .bak is written first):");
    console.log("  npm run doctor:env -- --fix");
  }
  console.log(
    "\nLeaving a FORTRESS_* variable unset is always safe: the code falls back\n" +
    "to the Monad mainnet addresses verified in ADDRESSES.md, and boot.ts\n" +
    "checks them against the live RPC before serving traffic.",
  );
  process.exitCode = 1;
}

main();
