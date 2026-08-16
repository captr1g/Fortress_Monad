import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { buildIdenticon, IDENTICON_GRID_SIZE } from "@fortress/core";
import { colors } from "@/lib/theme";

// Deterministic per-wallet avatar (a "blockie") — replaces a flat gradient
// circle with an actual generated identity mark, same idea as MetaMask/
// Rainbow. No upload/storage needed since it's derived purely from the address.
// Shares its pixel-grid math with the web version (packages/core/identicon.ts).
export function IdenticonAvatar({ address, size = 46 }: { address: string; size?: number }) {
  const { bg, fg, spot, cells } = buildIdenticon(address);
  const cell = size / IDENTICON_GRID_SIZE;
  const colorFor = (v: number) => (v === 1 ? fg : v === 2 ? spot : bg);

  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", borderWidth: 1, borderColor: colors.line, backgroundColor: bg }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {cells.map((row, r) =>
          row.map((v, c) =>
            v === 0 ? null : (
              <Rect key={`${r}-${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill={colorFor(v)} />
            ),
          ),
        )}
      </Svg>
    </View>
  );
}
