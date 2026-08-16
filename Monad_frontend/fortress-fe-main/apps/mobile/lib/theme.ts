import { Platform } from "react-native";

// Single source of design tokens for the mobile app — mirrors the web app's
// globals.css @theme palette. Screens import from here instead of re-declaring
// hex literals in every StyleSheet.
export const colors = {
  bg: "#0A0A0B",
  surface: "#131316",
  surface2: "#0e0e11",
  inset: "#161619",
  elevated: "#17181c",
  line: "#1e1e22",
  lineSoft: "#1c1c20",

  fg: "#FAFAFA",
  fgSoft: "#e9e9ec",
  muted: "#8a8a93",
  faint: "#5e5e66",
  ink: "#0A0A0B",

  green: "#10b981",
  greenBright: "#34D399",
  gold: "#FACC15",
  amber: "#f59e0b",
  red: "#ef4444",
  redSoft: "#f87171",
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const monoFont = Platform.select({ ios: "Menlo", android: "monospace" });
