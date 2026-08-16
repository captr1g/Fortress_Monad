/**
 * Retry wrapper for reads whose failure must not be papered over.
 *
 * Public Monad RPC drops connections often enough to matter — several
 * `UND_ERR_CONNECT_TIMEOUT`s were observed while diagnosing a single bug. viem's
 * transport already retries some transport-level errors, but a read that still
 * fails after that has, historically, been swallowed by a `catch` and replaced
 * with a guessed value. For anything that feeds slippage protection, a guess is
 * worse than an error: it produces a transaction that is guaranteed to revert,
 * and the user pays gas to discover that.
 */

const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 250;

export async function withRpcRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // A revert is a definitive answer from the chain — the contract does not
      // have this function, or it refused. Retrying just wastes time.
      if (isDeterministicRevert(err)) break;
      if (i < attempts - 1) {
        await sleep(BASE_DELAY_MS * 2 ** i);
      }
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message.split("\n")[0] : String(lastErr);
  throw new Error(`${label} failed after ${attempts} attempt(s): ${msg}`, {
    cause: lastErr,
  });
}

function isDeterministicRevert(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  if (name === "ContractFunctionRevertedError") return true;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("execution reverted") ||
    msg.includes("returned no data") ||
    msg.includes("function does not exist")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
