const RAY = 10n ** 27n;
const SECONDS_PER_YEAR = 31_536_000;

// mentioned in their docs only
export function rayToApy(rayValue: bigint): number {
  const apr = Number(rayValue) / Number(RAY);
  const apy = Math.pow(1 + apr / SECONDS_PER_YEAR, SECONDS_PER_YEAR) - 1;

  if (apy < 0 || apy > 2.0) {
    throw new Error(`APY out of bounds: ${apy} (ray: ${rayValue})`);
  }

  return apy;
}
