// Decodes on-chain revert data into human-readable messages.
//
// Tenderly (and most RPCs) report a custom-error revert as a bare "execution
// reverted" with the 4-byte selector + ABI-encoded args tucked into the raw
// return data — it can't name the error without the contract ABI. We own every
// Fortress contract's ABI, so we decode the selector ourselves: the vault, swap
// router, executors, and adapters all define custom errors, and turning the raw
// 0x-blob into e.g. "SlippageExceeded(received: 950, minimum: 1000)" is the
// difference between a debuggable failure and a mystifying one.
//
// Also handles the two standard reverts: Error(string) (require/revert "msg")
// and Panic(uint256) (Solidity asserts / arithmetic overflow / div-by-zero).

import { decodeErrorResult, toFunctionSelector, type Hex } from "viem";

// Every custom error declared across Contracts/src (grep-derived; keep in sync
// when adding contract errors). Selectors are computed at load time so this
// list stays the single source of truth — no hand-copied 4-byte values to rot.
const FORTRESS_ERROR_SIGNATURES = [
  "AdapterAlreadyRegistered(uint8)",
  "AdapterNotRegistered(uint8)",
  "BorrowBelowMinimum(uint256,uint256)",
  "BorrowExceedsCeiling(uint256,uint256)",
  "DeadlineExpired()",
  "FeeChangeAlreadyQueued()",
  "FeeChangeExpired()",
  "FeeChangeNotReady(uint48)",
  "FeeTooHigh()",
  "FlashCommitmentMismatch()",
  "InputTokenIsUsdc()",
  "InsufficientBalance()",
  "InsufficientLiquidity(uint256,uint256)",
  "InsufficientOutput(uint256,uint256)",
  "InsufficientRepayment(uint256,uint256)",
  "InvalidBps()",
  "InvalidData()",
  "InvalidRequestStatus()",
  "InvalidSubAction(uint8)",
  "InvalidTargetLtv()",
  "InvalidTimelockDelay()",
  "LiFiCallFailed()",
  "NoActiveFlash()",
  "NoCollateral()",
  "NoDebt()",
  "NoFeeChangeQueued()",
  "NothingToBorrow()",
  "NotRequestOwner()",
  "OnlyExecutor()",
  "OnlyKeeper()",
  "OnlyMorpho()",
  "OnlyVault()",
  "OraclePriceZero()",
  "PoolAlreadyExists(bytes32)",
  "PoolNotFound(bytes32)",
  "ProtocolExists(bytes32)",
  "ProtocolNotFound(bytes32)",
  "RefundTooEarly()",
  "RepayExceedsDebt(uint256,uint256)",
  "RequestNotFound()",
  "SameToken()",
  "SlippageExceeded(uint256,uint256)",
  "SlippageTooHigh()",
  "SwapFailed()",
  "SwapInputExceedsWithdrawn(uint256,uint256)",
  "SweepFailed(address)",
  "TooManySteps()",
  "UnauthorizedApproveTo(address)",
  "UnauthorizedCallTo(address)",
  "UnauthorizedDex(address)",
  "UnauthorizedMarket(address)",
  "UnauthorizedPool(bytes32)",
  "UnauthorizedSelector(bytes4)",
  "UnauthorizedWrapper(address)",
  "UnsupportedAction()",
  "UsdcNotConsumed()",
  "WithdrawExceedsCollateral(uint256,uint256)",
  "ZeroAddress()",
  "ZeroAmount()",
  "ZeroBalance()",
  "ZeroExecutor()",
  "ZeroFlashAssets()",
  "ZeroInputAssets()",
  "ZeroMinAmountOut()",
  "ZeroMinCollateralOut()",
  "ZeroMinLoanOut()",
  "ZeroSteps()",
] as const;

type ErrorEntry = { name: string; params: { name: string; type: string }[] };

// selector (0x + 8 hex) → { name, param names/types } for arg decoding.
const FORTRESS_ERRORS: Map<string, ErrorEntry> = (() => {
  const map = new Map<string, ErrorEntry>();
  for (const sig of FORTRESS_ERROR_SIGNATURES) {
    const name = sig.slice(0, sig.indexOf("("));
    const inner = sig.slice(sig.indexOf("(") + 1, sig.lastIndexOf(")"));
    const types = inner.length > 0 ? inner.split(",") : [];
    const params = types.map((type, i) => ({ name: `arg${i}`, type }));
    // NB: no "error " prefix — toFunctionSelector hashes the literal string, so
    // the prefix would poison the selector. The bare "Name(types)" signature is
    // what viem's encodeErrorResult uses on-chain.
    map.set(toFunctionSelector(sig), { name, params });
  }
  return map;
})();

// Human-friendly one-liners for the errors most likely to surface to a user
// building a strategy. Everything else falls back to "Name(decoded args)".
const FRIENDLY: Record<string, (args: readonly unknown[]) => string> = {
  SlippageExceeded: (a) =>
    `Swap output below the slippage floor — a DEX returned ${a[0]} but the plan required at least ${a[1]}. Rebuild the plan (routes go stale) or increase the amount so the swap clears minimums.`,
  SwapFailed: () =>
    "A DEX swap call reverted — the route is likely stale or the pool can't fill this size. Rebuild the plan and sign promptly.",
  InsufficientOutput: (a) =>
    `A step produced less than required (expected ${a[0]}, got ${a[1]}). Usually a stale route or an amount too small to route cleanly.`,
  DeadlineExpired: () =>
    "The plan's deadline passed before it executed — rebuild the plan and sign immediately.",
  NothingToBorrow: () =>
    "The borrow step had nothing to borrow — collateral was too small to open a position at this LTV. Increase the amount.",
  BorrowBelowMinimum: (a) =>
    `The computed borrow (${a[0]}) is below the market minimum (${a[1]}) — the position is too small. Increase the amount or the LTV.`,
  ZeroMinAmountOut: () =>
    "A swap step resolved to a zero minimum-out (the amount is too small to quote). Increase the amount.",
  ZeroAmount: () =>
    "A step resolved to a zero amount — usually an input too small to split across the strategy. Increase the amount.",
  ZeroBalance: () =>
    "A swap step found no balance to swap — a prior step produced nothing (often a dust amount). Increase the amount.",
  AdapterNotRegistered: (a) =>
    `Strategy executor is missing adapter #${a[0]} — a required adapter isn't registered on-chain. This is a configuration issue, not your input.`,
  UnauthorizedDex: (a) =>
    `A swap routed through a DEX (${a[0]}) that isn't allowlisted on-chain. Configuration issue.`,
  UnauthorizedSelector: (a) =>
    `A swap used a function selector (${a[0]}) that isn't allowlisted on-chain. Configuration issue.`,
};

/// Attempt to decode a raw revert data blob (0x + selector + abi-encoded args).
/// Returns a human message, or null if the blob isn't a recognizable revert.
export function decodeRevertData(data: Hex): string | null {
  if (!data || data.length < 10) return null; // need at least a 4-byte selector

  const selector = data.slice(0, 10).toLowerCase();

  // Standard Error(string) — require(false, "msg") / revert("msg").
  if (selector === "0x08c379a0") {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: "error", name: "Error", inputs: [{ name: "reason", type: "string" }] }],
        data,
      });
      return String(decoded.args?.[0] ?? "reverted");
    } catch {
      return null;
    }
  }

  // Standard Panic(uint256) — asserts, overflow, div-by-zero, array OOB.
  if (selector === "0x4e487b71") {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: "error", name: "Panic", inputs: [{ name: "code", type: "uint256" }] }],
        data,
      });
      const code = BigInt(decoded.args?.[0] as bigint);
      return `Solidity panic (0x${code.toString(16)})${panicHint(code)}`;
    } catch {
      return null;
    }
  }

  // Fortress custom errors.
  const entry = FORTRESS_ERRORS.get(selector);
  if (!entry) return null;

  let args: readonly unknown[] = [];
  if (entry.params.length > 0) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: "error", name: entry.name, inputs: entry.params }],
        data,
      });
      args = (decoded.args ?? []) as readonly unknown[];
    } catch {
      // Selector matched but args didn't decode — still name the error.
      args = [];
    }
  }

  const friendly = FRIENDLY[entry.name];
  if (friendly && args.length === entry.params.length) return friendly(args);

  // Generic: "Name(arg0, arg1)" with stringified args.
  const argStr = args.map((a) => String(a)).join(", ");
  return argStr ? `${entry.name}(${argStr})` : entry.name;
}

function panicHint(code: bigint): string {
  switch (code) {
    case 0x01n: return " — assertion failed";
    case 0x11n: return " — arithmetic overflow/underflow";
    case 0x12n: return " — division or modulo by zero";
    case 0x32n: return " — array index out of bounds";
    default: return "";
  }
}

/// Scans an arbitrary Tenderly result object for the first hex blob that decodes
/// as a known revert, and returns the human message. Robust to Tenderly's
/// varying field names (error_info, call_trace output, nested calls) — we just
/// hunt every 0x-blob in the payload and try to decode it. Returns null if
/// nothing recognizable is found.
export function decodeRevertFromResult(result: unknown): string | null {
  const seen = new Set<string>();
  const blobs: string[] = [];
  collectHexBlobs(result, blobs, seen);

  // Prefer longer blobs (they carry args); a bare selector still decodes.
  blobs.sort((a, b) => b.length - a.length);
  for (const blob of blobs) {
    const decoded = decodeRevertData(blob as Hex);
    if (decoded) return decoded;
  }
  return null;
}

function collectHexBlobs(node: unknown, out: string[], seen: Set<string>): void {
  if (node == null) return;
  if (typeof node === "string") {
    // A revert blob is 0x + a multiple of 32-byte words after the 4-byte
    // selector: length is 2 + 8 + 64*n. Accept anything >= a bare selector.
    const matches = node.match(/0x[0-9a-fA-F]{8,}/g);
    if (matches) {
      for (const m of matches) {
        const lower = m.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          out.push(lower);
        }
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectHexBlobs(item, out, seen);
    return;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) {
      collectHexBlobs(value, out, seen);
    }
  }
}
