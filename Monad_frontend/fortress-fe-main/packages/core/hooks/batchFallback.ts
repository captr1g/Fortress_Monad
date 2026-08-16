// Decides whether a failed EIP-5792 `wallet_sendCalls` should fall back to
// sending each call on its own.
//
// Deliberately dependency-free (no react, no wagmi, no viem) so it can be
// reasoned about and tested without a browser or a wallet.

// EIP-1193 / JSON-RPC "this method doesn't exist here".
const METHOD_UNSUPPORTED = new Set([4200, -32601]);

// EIP-5792's own error codes for "this bundle can't be sent as a batch".
// Every one of these is a reason to send the calls one at a time instead —
// none of them means the user refused the transaction.
//
//   5700  wallet lacks a capability that wasn't marked optional
//   5740  bundle too large for the wallet to process
//   5750  wallet COULD batch after an EIP-7702 upgrade, user declined it
//   5760  wallet has no atomic execution and the request required it
//
// 5750 is the one that matters in practice: MetaMask offers an EIP-7702
// account upgrade, and declining it is a perfectly ordinary choice that used
// to abort the whole deploy. Declining an ACCOUNT UPGRADE is not declining the
// TRANSACTION — the sequential path works fine on an un-upgraded EOA.
const BATCH_UNSUPPORTED = new Set([5700, 5740, 5750, 5760]);

// 4001 is the user rejecting the transaction itself. That must propagate:
// retrying it sequentially would re-prompt someone who already said no.
const USER_REJECTED = 4001;

/**
 * viem nests the provider error under `.cause`, sometimes more than one level
 * deep, so read the whole chain rather than just the top two.
 */
export function errorCodes(err: unknown): number[] {
  const codes: number[] = [];
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth++) {
    const e = cur as { code?: unknown; cause?: unknown };
    if (typeof e.code === "number") codes.push(e.code);
    cur = e.cause;
  }
  return codes;
}

/**
 * Whether a batch attempt failed for a reason the sequential path can recover
 * from.
 *
 * Deliberately code-driven. This was a substring match on the error message
 * ("does not support", "not supported", …), which silently missed 5750 because
 * its message reads "The Wallet CAN support atomicity after an upgrade, but the
 * user rejected the upgrade" — no such substring. A whole deploy died on an
 * error whose own text says a fallback exists.
 */
export function isBatchUnsupported(err: unknown): boolean {
  const codes = errorCodes(err);
  if (codes.includes(USER_REJECTED)) return false;
  if (codes.some((c) => METHOD_UNSUPPORTED.has(c) || BATCH_UNSUPPORTED.has(c))) {
    return true;
  }

  // Wallets that return a non-standard error shape (no numeric code) still
  // need to fall back, so keep a message check — but only after the code
  // checks above have had their say, and never for a user rejection.
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes("user rejected the request")) return false;
  return (
    msg.includes("does not support") ||
    msg.includes("not supported") ||
    msg.includes("unsupported method") ||
    msg.includes("method not found") ||
    msg.includes("wallet_sendcalls") ||
    msg.includes("atomic")
  );
}
