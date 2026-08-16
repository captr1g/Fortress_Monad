// Gating + preconditions for the real-call tier. Integration/contract/api/e2e
// tests skip entirely unless RUN_INTEGRATION is set, so the fast tier never needs
// network or credentials.
import { describe } from "vitest";

export const INTEGRATION_ENABLED =
  process.env.RUN_INTEGRATION === "1" ||
  process.env.RUN_INTEGRATION === "true";

/** describe() that is skipped unless RUN_INTEGRATION is enabled. */
export const describeIntegration: typeof describe.skip = INTEGRATION_ENABLED
  ? (describe as typeof describe.skip)
  : describe.skip;

/** Assert an env var is present; returns it typed as string. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Integration test requires env var ${name}`);
  return v;
}

/** True when every named env var is present (used to skip sub-suites cleanly). */
export function hasEnv(...names: string[]): boolean {
  return names.every((n) => Boolean(process.env[n]));
}
