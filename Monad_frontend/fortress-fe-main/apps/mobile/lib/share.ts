import { Share } from "react-native";

// Native OS share sheet for a strategy — app-exclusive (web has no equivalent).
export async function shareStrategy(input: {
  name: string;
  netApy?: number; // fraction, e.g. 0.0188
  stepCount?: number;
  prompt: string;
}): Promise<void> {
  const lines = [`${input.name} — built with Fortress`];

  const stats: string[] = [];
  if (input.netApy !== undefined) {
    stats.push(`Net APY ${input.netApy >= 0 ? "+" : ""}${(input.netApy * 100).toFixed(2)}%`);
  }
  if (input.stepCount) stats.push(`${input.stepCount} step${input.stepCount === 1 ? "" : "s"}`);
  if (stats.length) lines.push(stats.join(" · "));

  lines.push("", input.prompt);

  try {
    await Share.share({ message: lines.join("\n") });
  } catch {
    // User dismissed or share unavailable — nothing to do.
  }
}
