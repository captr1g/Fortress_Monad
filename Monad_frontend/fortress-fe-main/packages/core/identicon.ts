// Deterministic per-wallet identicon: a horizontally-symmetric pixel grid in a
// two-tone palette derived from the address hash — the same idea as MetaMask/
// Rainbow's wallet "blockies", no external dependency. Shared so web and
// mobile render byte-identical avatars for the same address.

export type Identicon = {
  bg: string;
  fg: string;
  spot: string;
  /** ROWS x COLS grid; each cell is 0 (bg) | 1 (fg) | 2 (spot). */
  cells: number[][];
};

export const IDENTICON_GRID_SIZE = 6;

function hashSeed(input: string): number {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Small, fast, seeded PRNG — good enough distribution for a decorative pattern.
function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildIdenticon(address: string): Identicon {
  const seed = hashSeed(address.toLowerCase());
  const rand = mulberry32(seed);

  const hueBg = Math.floor(rand() * 360);
  const hueFg = (hueBg + 100 + Math.floor(rand() * 140)) % 360;
  const hueSpot = (hueFg + 40 + Math.floor(rand() * 60)) % 360;

  const bg = `hsl(${hueBg}, 30%, 15%)`;
  const fg = `hsl(${hueFg}, 62%, 52%)`;
  const spot = `hsl(${hueSpot}, 70%, 60%)`;

  const size = IDENTICON_GRID_SIZE;
  const half = size / 2;
  const cells: number[][] = [];
  for (let row = 0; row < size; row++) {
    const left: number[] = [];
    for (let col = 0; col < half; col++) {
      const r = rand();
      left.push(r > 0.6 ? 0 : r > 0.25 ? 1 : 2); // background-weighted
    }
    // Mirror the left half onto the right half for left-right symmetry.
    cells.push([...left, ...[...left].reverse()]);
  }

  return { bg, fg, spot, cells };
}
