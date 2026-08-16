import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Svg, { Path, Circle } from "react-native-svg";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { VaultRings } from "@/components/VaultRings";
import { PressableScale } from "@/components/PressableScale";
import { TAB_BAR_BASE_HEIGHT } from "@/components/AppTabBar";
import { colors, radius } from "@/lib/theme";

const PILLARS = [
  {
    title: "Discover",
    body: "Browse strategies published by the community, ranked by live performance.",
    icon: (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Circle cx={11} cy={11} r={7} />
        <Path d="M21 21l-4.35-4.35" />
      </Svg>
    ),
  },
  {
    title: "Publish",
    body: "Sign in with X and put your best strategies in front of everyone.",
    icon: (
      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 19V5" />
        <Path d="M5 12l7-7 7 7" />
      </Svg>
    ),
  },
];

// Mobile rendition of the web marketplace teaser — the Strategies tab's
// placeholder until the real marketplace ships. Vault rings (not the wave)
// as the ambient backdrop.
export function MarketplaceTeaser() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ringSize = width * 1.15;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center" }]}>
        <View style={{ position: "absolute", top: height * 0.32 - ringSize / 2 }}>
          <VaultRings size={ringSize} />
        </View>
      </View>

      <View style={[styles.center, { paddingBottom: TAB_BAR_BASE_HEIGHT + insets.bottom }]}>
        <Animated.View entering={FadeInUp.duration(450)} style={styles.pill}>
          <Text style={styles.pillText}>Coming soon</Text>
        </Animated.View>

        <Animated.Text entering={FadeInUp.duration(450).delay(90)} style={styles.headline}>
          Strategy <Text style={{ color: colors.muted }}>Marketplace</Text>
        </Animated.Text>
        <Animated.Text entering={FadeInUp.duration(450).delay(180)} style={styles.subcopy}>
          A public gallery of community strategies. Discover what's working, deploy in one
          tap, and publish your own.
        </Animated.Text>

        <View style={styles.pillarsWrap}>
          {PILLARS.map((p, i) => (
            <Animated.View key={p.title} entering={FadeInDown.duration(400).delay(300 + i * 90)} style={styles.pillarCard}>
              <View style={styles.pillarIcon}>{p.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.pillarTitle}>{p.title}</Text>
                <Text style={styles.pillarBody}>{p.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <Animated.View entering={FadeInUp.duration(450).delay(540)} style={{ width: "100%" }}>
          <PressableScale style={styles.cta} onPress={() => router.push("/(tabs)")}>
            <Text style={styles.ctaText}>Build your own now →</Text>
          </PressableScale>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 28, gap: 0 },

  pill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 16,
  },
  pillText: { color: colors.muted, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 2 },

  headline: { color: colors.fg, fontSize: 28, fontWeight: "800", letterSpacing: -0.4, textAlign: "center" },
  subcopy: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 10, maxWidth: 320 },

  pillarsWrap: { width: "100%", gap: 9, marginTop: 28 },
  pillarCard: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    backgroundColor: "rgba(19,19,22,0.86)",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
  },
  pillarIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.lineSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pillarTitle: { color: colors.fg, fontSize: 13.5, fontWeight: "700" },
  pillarBody: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },

  cta: {
    marginTop: 28,
    backgroundColor: colors.fg,
    borderRadius: radius.lg,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  ctaText: { color: colors.ink, fontSize: 15, fontWeight: "700" },
});
