// wagmi/viem errors carry a clean one-line `shortMessage` (e.g. "User
// rejected the request.") alongside a verbose `.message` that bundles the
// full Request Arguments / Details / Version block on top of it — never
// show that raw dump to a user. Prefer `shortMessage`, with a couple of
// product-tone overrides, and cap the fallback so nothing verbose slips
// through some other error shape either.

type ViemLikeError = { shortMessage?: unknown };

const FRIENDLY_OVERRIDES: Record<string, string> = {
  "User rejected the request.": "Transaction cancelled.",
};

const MAX_FALLBACK_LENGTH = 160;

export function humanizeError(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "shortMessage" in err) {
    const short = (err as ViemLikeError).shortMessage;
    if (typeof short === "string" && short.length > 0) {
      return FRIENDLY_OVERRIDES[short] ?? short;
    }
  }
  if (err instanceof Error && err.message) {
    return err.message.length > MAX_FALLBACK_LENGTH
      ? `${err.message.slice(0, MAX_FALLBACK_LENGTH)}…`
      : err.message;
  }
  return fallback;
}
