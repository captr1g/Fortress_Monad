import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppKit, useAccount } from "@reown/appkit-react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInDown, FadeInUp, ZoomIn } from "react-native-reanimated";
import { FortressMark } from "@/components/FortressMark";
import { VaultRings } from "@/components/VaultRings";
import { PressableScale } from "@/components/PressableScale";
import { colors, radius, monoFont } from "@/lib/theme";
import { success } from "@/lib/haptics";

const STEPS = [
  { n: "01", title: "Connect", body: "Connect your wallet. No passwords." },
  { n: "02", title: "Describe", body: "Say what you want, in plain language." },
  { n: "03", title: "Deploy", body: "Approve once. Entry and exit run automatically." },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { open } = useAppKit();
  const { isConnected, address } = useAccount();

  // Physical confirmation the moment the wallet actually connects (the modal
  // handles its own UI, so this is the app's own "you're in" signal).
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) success();
    wasConnected.current = isConnected;
  }, [isConnected]);

  const ringSize = width * 1.35;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Vault-lock rings, centered on the brand block (upper-center). */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center" }]}>
        <View style={{ position: "absolute", top: height * 0.3 - ringSize / 2 }}>
          <VaultRings size={ringSize} />
        </View>
      </View>

      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(16).delay(100)} style={styles.brandRow}>
          <FortressMark size={46} />
          <Text style={styles.brandName}>Fortress</Text>
          <View style={styles.betaBadge}>
            <Text style={styles.betaBadgeText}>Beta</Text>
          </View>
        </Animated.View>

        <Animated.Text entering={FadeInUp.duration(500).delay(250)} style={styles.headline}>
          Autonomous DeFi{"\n"}strategies.
        </Animated.Text>
        <Animated.Text entering={FadeInUp.duration(500).delay(360)} style={styles.subcopy}>
          Describe a strategy in plain language. Fortress builds it, simulates it, and runs entry and exit on-chain
          automatically.
        </Animated.Text>

        <View style={styles.stepsWrap}>
          {STEPS.map((s, i) => (
            <Animated.View key={s.n} entering={FadeInDown.duration(450).delay(480 + i * 90)} style={styles.stepRow}>
              <Text style={styles.stepNum}>{s.n}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.stepTitle}>{s.title}</Text>
                <Text style={styles.stepBody}>{s.body}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>

      <Animated.View
        entering={FadeInUp.duration(500).delay(800)}
        style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}
      >
        {isConnected && address ? (
          <Animated.View entering={FadeIn.duration(300)} style={styles.footerInner}>
            <Text style={styles.address}>
              {address.slice(0, 6)}…{address.slice(-4)}
            </Text>
            <PressableScale style={styles.button} onPress={() => router.replace("/(tabs)")}>
              <Text style={styles.buttonText}>Continue</Text>
            </PressableScale>
          </Animated.View>
        ) : (
          <View style={styles.footerInner}>
            <PressableScale style={styles.button} onPress={() => open()}>
              <Text style={styles.buttonText}>Connect Wallet</Text>
            </PressableScale>
            <Text style={styles.disclaimer}>Sign a message to verify it&apos;s you — no gas, no risk.</Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: "center", paddingHorizontal: 28 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 30 },
  brandName: { color: colors.fg, fontSize: 21, fontWeight: "800", letterSpacing: -0.4 },
  betaBadge: { borderWidth: 1, borderColor: "#232328", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  betaBadgeText: { color: colors.muted, fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },

  headline: { color: colors.fg, fontSize: 31, fontWeight: "800", lineHeight: 36, letterSpacing: -0.4, marginBottom: 14 },
  subcopy: { color: colors.muted, fontSize: 15, lineHeight: 23, marginBottom: 30 },

  stepsWrap: { gap: 9 },
  stepRow: { flexDirection: "row", gap: 12, backgroundColor: "rgba(19,19,22,0.86)", borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 13 },
  stepNum: { color: colors.faint, fontSize: 11.5, marginTop: 1, fontVariant: ["tabular-nums"] },
  stepTitle: { color: colors.fg, fontSize: 13.5, fontWeight: "600" },
  stepBody: { color: colors.muted, fontSize: 12, marginTop: 2 },

  footer: { paddingHorizontal: 24 },
  footerInner: { alignItems: "center", gap: 13 },
  button: { backgroundColor: colors.fg, borderRadius: radius.lg, height: 54, alignItems: "center", justifyContent: "center", width: "100%" },
  buttonText: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  disclaimer: { color: colors.faint, fontSize: 12, textAlign: "center" },
  address: { color: colors.greenBright, fontSize: 15, fontFamily: monoFont },
});
