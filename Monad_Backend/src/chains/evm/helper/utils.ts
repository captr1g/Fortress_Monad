export function ltvToWad(targetLtv: number): bigint {
  return BigInt(Math.round(targetLtv * 1e18));
}

export function norm(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}
