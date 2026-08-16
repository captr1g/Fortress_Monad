// wagmi/viem errors carry a clean one-line `shortMessage` (e.g. "User
// rejected the request.") alongside a verbose `.message` that bundles the
// full Request Arguments / Details / Version block on top of it — never
// show that raw dump to a user. Prefer `shortMessage`, with a couple of
// product-tone overrides, and cap the fallback so nothing verbose slips
// through some other error shape either.

type ViemLikeError = { shortMessage?: unknown };

const FRIENDLY_OVERRIDES: Record<string, string> = {
  "User rejected the request.": "Transaction cancelled.",
  // EIP-5792 / EIP-7702. These now trigger the sequential fallback in
  // useSendPlanCalls, so a user should never see them — but if one does reach
  // the UI, the raw text talks about "atomicity" and "upgrades", which means
  // nothing to someone who just wanted to deposit.
  "The Wallet can support atomicity after an upgrade, but the user rejected the upgrade.":
    "Your wallet needs a one-time upgrade to sign these together. You can decline it — we'll ask you to sign each step separately instead.",
  "The wallet does not support atomic execution but the request requires it.":
    "Your wallet can't sign these together, so we'll ask you to sign each step separately.",
  "The call bundle is too large for the Wallet to process.":
    "Too many steps for your wallet to sign at once — we'll send them one at a time.",
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
