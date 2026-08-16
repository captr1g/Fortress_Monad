import Svg, { Path, Rect } from "react-native-svg";

export function PromptTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Path
        d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"
        fill={focused ? "rgba(52,211,153,0.15)" : "none"}
      />
    </Svg>
  );
}

export function PortfolioTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
      <Rect x={3} y={6} width={18} height={13} rx={2} fill={focused ? "rgba(52,211,153,0.15)" : "none"} />
      <Path d="M3 10h18M8 14h3" />
    </Svg>
  );
}

export function SavedTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round">
      <Path
        d="M6 4.5A1.5 1.5 0 017.5 3h9A1.5 1.5 0 0118 4.5V21l-6-3.75L6 21V4.5z"
        fill={focused ? "rgba(52,211,153,0.15)" : "none"}
      />
    </Svg>
  );
}

export function StrategiesTabIcon({ color, focused }: { color: string; focused: boolean }) {
  // Storefront awning — the marketplace.
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path
        d="M4 10v9a1 1 0 001 1h14a1 1 0 001-1v-9"
        fill={focused ? "rgba(52,211,153,0.15)" : "none"}
      />
      <Path d="M3 6l1.5-3h15L21 6M3 6v1a3 3 0 006 0V6m0 0v1a3 3 0 006 0V6m0 0v1a3 3 0 006 0V6M3 6h18" />
      <Path d="M10 20v-5h4v5" />
    </Svg>
  );
}

export function ProfileTabIcon({ color, focused }: { color: string; focused: boolean }) {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0z"
        fill={focused ? "rgba(52,211,153,0.15)" : "none"}
      />
      <Path d="M5 21a7 7 0 0114 0" fill={focused ? "rgba(52,211,153,0.15)" : "none"} />
    </Svg>
  );
}
