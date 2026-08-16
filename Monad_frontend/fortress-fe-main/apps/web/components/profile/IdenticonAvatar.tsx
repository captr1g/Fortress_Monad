import { buildIdenticon, IDENTICON_GRID_SIZE } from "@fortress/core";

// Deterministic per-wallet avatar (a "blockie") — replaces a flat gradient
// circle with an actual generated identity mark, same idea as MetaMask/
// Rainbow. No upload/storage needed since it's derived purely from the address.
export function IdenticonAvatar({ address, size = 56 }: { address: string; size?: number }) {
  const { bg, fg, spot, cells } = buildIdenticon(address);
  const cell = size / IDENTICON_GRID_SIZE;
  const colorFor = (v: number) => (v === 1 ? fg : v === 2 ? spot : bg);

  return (
    <div
      className="flex-none overflow-hidden rounded-full border border-line"
      style={{ width: size, height: size, background: bg }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map((row, r) =>
          row.map((v, c) =>
            v === 0 ? null : (
              <rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={colorFor(v)} />
            ),
          ),
        )}
      </svg>
    </div>
  );
}
